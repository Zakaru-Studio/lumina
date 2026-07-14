//! The face ML engine: YuNet detection + SFace embedding, run on the CPU
//! through the pure-Rust `tract` ONNX engine (no native runtime to ship).
//!
//! Pipeline for one image:
//!   1. Letterbox-resize to a fixed 640×640 BGR tensor and run **YuNet** → a set
//!      of face boxes with 5 landmarks and a confidence.
//!   2. For each kept box, align the face to the canonical 112×112 ArcFace
//!      template (similarity transform from the 5 landmarks) and run **SFace**
//!      → a 128-d descriptor, which we L2-normalize (so cosine == dot product).
//!
//! Everything is CPU-bound and side-effect free; a `FaceEngine` is `Send + Sync`
//! and its models are immutable after load, so it can be shared across Rayon
//! workers and `run()` concurrently.
//!
//! NOTE: YuNet's output decoding is reconstructed from the model's tensor
//! *shapes* (not output names), which makes it robust to graph re-export, but
//! the exact decode constants (strides, box formula, landmark template) are the
//! documented OpenCV values and should be validated against a real run once the
//! weights are installed.

use image::{imageops::FilterType, RgbImage};
use tract_onnx::prelude::*;

use super::models::ModelPaths;
use crate::core::error::{Error, Result};

/// Fixed detector input side (must be a multiple of the largest stride, 32).
const DET_SIZE: usize = 640;
/// Detector strides; YuNet emits one prediction head per stride.
const STRIDES: [usize; 3] = [8, 16, 32];
/// Minimum detection confidence to keep a face.
const DET_SCORE_THRESH: f32 = 0.6;
/// IoU threshold for non-maximum suppression.
const DET_NMS_IOU: f32 = 0.3;
/// Hard cap on faces kept per image (defensive; real photos have far fewer).
const MAX_FACES: usize = 64;
/// Minimum face side (original-image pixels) to keep. Below this the aligned
/// crop is too coarse for a trustworthy embedding.
const MIN_FACE_PX: f32 = 32.0;

/// SFace input side.
const EMB_SIZE: usize = 112;
/// SFace descriptor dimensionality.
pub const EMB_DIM: usize = 128;

/// Canonical 5-point template (right-eye, left-eye, nose, right-mouth,
/// left-mouth) in 112×112 space — the reference OpenCV's `alignCrop` maps
/// YuNet landmarks onto before SFace. Order matches YuNet's landmark order.
const TEMPLATE: [[f32; 2]; 5] = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];

/// A runnable, optimized tract plan (typed graph after declutter+optimize).
type Plan = RunnableModel<TypedFact, Box<dyn TypedOp>, TypedModel>;

/// A detected face with its normalized geometry and descriptor.
#[derive(Debug, Clone)]
pub struct AnalyzedFace {
    /// Bounding box in normalized 0..1 coordinates of the (display-oriented) image.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// Detector confidence 0..1.
    pub score: f32,
    /// L2-normalized descriptor, length [`EMB_DIM`].
    pub embedding: Vec<f32>,
}

/// Loaded detector + embedder, ready for repeated inference.
pub struct FaceEngine {
    detector: Plan,
    embedder: Plan,
}

impl FaceEngine {
    /// Load and optimize both models. Expensive (a few hundred ms); do it once.
    pub fn load(paths: &ModelPaths) -> Result<Self> {
        let detector = load_plan(&paths.detector, DET_SIZE, DET_SIZE)?;
        let embedder = load_plan(&paths.embedder, EMB_SIZE, EMB_SIZE)?;
        Ok(Self { detector, embedder })
    }

    /// Detect all faces in `img` and compute a descriptor for each.
    pub fn analyze(&self, img: &RgbImage) -> Result<Vec<AnalyzedFace>> {
        let (iw, ih) = (img.width() as f32, img.height() as f32);
        if iw < 1.0 || ih < 1.0 {
            return Ok(Vec::new());
        }
        let dets = self.detect(img)?;
        let mut out = Vec::with_capacity(dets.len());
        for d in dets {
            // Skip tiny faces: their crops carry too little detail for a
            // reliable descriptor and mostly add clustering noise.
            if d.w < MIN_FACE_PX || d.h < MIN_FACE_PX {
                continue;
            }
            // `d` (bbox + landmarks) is already in original-image pixel space, so
            // align straight from the landmarks; only the stored bbox is normalized.
            let aligned = align_crop(img, &d.landmarks);
            let embedding = self.embed(&aligned)?;
            out.push(AnalyzedFace {
                x: d.x / iw,
                y: d.y / ih,
                w: d.w / iw,
                h: d.h / ih,
                score: d.score,
                embedding,
            });
        }
        Ok(out)
    }

    /// Run YuNet and return boxes/landmarks in original-image pixel coordinates.
    fn detect(&self, img: &RgbImage) -> Result<Vec<RawDet>> {
        let lb = Letterbox::compute(img.width(), img.height(), DET_SIZE as u32);
        let resized = image::imageops::resize(img, lb.new_w, lb.new_h, FilterType::Triangle);

        // BGR, 0..255, NCHW [1,3,640,640], zero-padded outside the resized area.
        let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, DET_SIZE, DET_SIZE));
        for y in 0..lb.new_h {
            for x in 0..lb.new_w {
                let p = resized.get_pixel(x, y).0;
                let (ty, tx) = ((y + lb.pad_y) as usize, (x + lb.pad_x) as usize);
                input[[0, 0, ty, tx]] = p[2] as f32; // B
                input[[0, 1, ty, tx]] = p[1] as f32; // G
                input[[0, 2, ty, tx]] = p[0] as f32; // R
            }
        }

        let outputs = self
            .detector
            .run(tvec!(input.into_tensor().into()))
            .map_err(|e| Error::Other(format!("YuNet inference failed: {e}")))?;

        // Classify the model's outputs purely by shape (see module note):
        // last dim 4 → bbox, 10 → landmarks, 1 → a score factor. Anchor count
        // N = 40²·(8/stride)² identifies the stride.
        let heads = classify_outputs(&outputs)?;

        let mut dets: Vec<RawDet> = Vec::new();
        for &stride in &STRIDES {
            let cols = DET_SIZE / stride;
            let n = cols * cols;
            let head = match heads.iter().find(|h| h.n == n) {
                Some(h) => h,
                None => continue,
            };
            let bbox = view_f32(&outputs[head.bbox])?;
            let kps = view_f32(&outputs[head.kps])?;
            let s0 = view_f32(&outputs[head.score_a])?;
            let s1 = view_f32(&outputs[head.score_b])?;
            for i in 0..n {
                let score = (clamp01(s0[i]) * clamp01(s1[i])).sqrt();
                if score < DET_SCORE_THRESH {
                    continue;
                }
                let (row, col) = (i / cols, i % cols);
                let (cx, cy) = (col as f32, row as f32);
                let sf = stride as f32;
                let bx = bbox[i * 4];
                let by = bbox[i * 4 + 1];
                let bw = bbox[i * 4 + 2];
                let bh = bbox[i * 4 + 3];
                let cxp = (cx + bx) * sf;
                let cyp = (cy + by) * sf;
                let wp = bw.exp() * sf;
                let hp = bh.exp() * sf;
                let mut det = RawDet {
                    x: cxp - wp / 2.0,
                    y: cyp - hp / 2.0,
                    w: wp,
                    h: hp,
                    score,
                    landmarks: [[0.0; 2]; 5],
                };
                for j in 0..5 {
                    det.landmarks[j] = [
                        (cx + kps[i * 10 + 2 * j]) * sf,
                        (cy + kps[i * 10 + 2 * j + 1]) * sf,
                    ];
                }
                dets.push(det);
            }
        }

        // NMS in letterboxed space, then map geometry back to original pixels.
        let kept = nms(dets, DET_NMS_IOU);
        Ok(kept
            .into_iter()
            .take(MAX_FACES)
            .map(|mut d| {
                d.map_from_letterbox(&lb);
                d
            })
            .collect())
    }

    /// Run SFace on an aligned 112×112 RGB crop and L2-normalize the descriptor.
    fn embed(&self, aligned_rgb: &[f32]) -> Result<Vec<f32>> {
        let input = tract_ndarray::Array4::<f32>::from_shape_vec(
            (1, 3, EMB_SIZE, EMB_SIZE),
            aligned_rgb.to_vec(),
        )
        .map_err(|e| Error::Other(format!("bad SFace input shape: {e}")))?;
        let outputs = self
            .embedder
            .run(tvec!(input.into_tensor().into()))
            .map_err(|e| Error::Other(format!("SFace inference failed: {e}")))?;
        let view = view_f32(&outputs[0])?;
        if view.len() < EMB_DIM {
            return Err(Error::Other(format!(
                "SFace produced {} values, expected {}",
                view.len(),
                EMB_DIM
            )));
        }
        let mut v: Vec<f32> = view[..EMB_DIM].to_vec();
        l2_normalize(&mut v);
        Ok(v)
    }
}

/// One prediction head (a group of outputs sharing an anchor count).
struct Head {
    n: usize,
    bbox: usize,
    kps: usize,
    score_a: usize,
    score_b: usize,
}

/// Group the detector outputs by anchor count and role, inferred from shapes.
fn classify_outputs(outputs: &[TValue]) -> Result<Vec<Head>> {
    use std::collections::HashMap;
    // Per anchor-count, collect output indices bucketed by last-dim role.
    let mut groups: HashMap<usize, (Option<usize>, Option<usize>, Vec<usize>)> = HashMap::new();
    for (idx, t) in outputs.iter().enumerate() {
        let shape = t.shape();
        if shape.is_empty() {
            continue;
        }
        let last = shape[shape.len() - 1];
        let total: usize = shape.iter().product();
        if last == 0 {
            continue;
        }
        let n = total / last;
        let entry = groups.entry(n).or_insert((None, None, Vec::new()));
        match last {
            4 => entry.0 = Some(idx),
            10 => entry.1 = Some(idx),
            1 => entry.2.push(idx),
            _ => {}
        }
    }
    let mut heads = Vec::new();
    for (n, (bbox, kps, scores)) in groups {
        if let (Some(bbox), Some(kps)) = (bbox, kps) {
            if scores.len() >= 2 {
                heads.push(Head {
                    n,
                    bbox,
                    kps,
                    score_a: scores[0],
                    score_b: scores[1],
                });
            }
        }
    }
    if heads.is_empty() {
        return Err(Error::Other(
            "unexpected YuNet output layout — cannot decode detections".into(),
        ));
    }
    Ok(heads)
}

/// A detection in the coordinate space it was produced in (letterboxed, then
/// mapped to original pixels by [`RawDet::map_from_letterbox`]).
#[derive(Debug, Clone)]
struct RawDet {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    score: f32,
    landmarks: [[f32; 2]; 5],
}

impl RawDet {
    fn map_from_letterbox(&mut self, lb: &Letterbox) {
        let inv = 1.0 / lb.scale;
        self.x = (self.x - lb.pad_x as f32) * inv;
        self.y = (self.y - lb.pad_y as f32) * inv;
        self.w *= inv;
        self.h *= inv;
        for p in self.landmarks.iter_mut() {
            p[0] = (p[0] - lb.pad_x as f32) * inv;
            p[1] = (p[1] - lb.pad_y as f32) * inv;
        }
    }
}

/// Aspect-preserving fit of an image into a square with symmetric padding.
struct Letterbox {
    scale: f32,
    new_w: u32,
    new_h: u32,
    pad_x: u32,
    pad_y: u32,
}

impl Letterbox {
    fn compute(w: u32, h: u32, size: u32) -> Self {
        let scale = (size as f32 / w as f32).min(size as f32 / h as f32);
        let new_w = ((w as f32 * scale).round() as u32).clamp(1, size);
        let new_h = ((h as f32 * scale).round() as u32).clamp(1, size);
        Self {
            scale,
            new_w,
            new_h,
            pad_x: (size - new_w) / 2,
            pad_y: (size - new_h) / 2,
        }
    }
}

/// Load a model, fix its single input to [1,3,h,w] f32, optimize and make runnable.
fn load_plan(path: &std::path::Path, h: usize, w: usize) -> Result<Plan> {
    let plan = tract_onnx::onnx()
        .model_for_path(path)
        .map_err(|e| Error::Other(format!("cannot read model {}: {e}", path.display())))?
        .with_input_fact(0, f32::fact([1, 3, h, w]).into())
        .map_err(|e| Error::Other(format!("bad input fact for {}: {e}", path.display())))?
        .into_optimized()
        .map_err(|e| Error::Other(format!("cannot optimize {}: {e}", path.display())))?
        .into_runnable()
        .map_err(|e| Error::Other(format!("cannot build plan for {}: {e}", path.display())))?;
    Ok(plan)
}

/// Borrow an output tensor as a flat f32 slice (row-major).
fn view_f32(t: &TValue) -> Result<Vec<f32>> {
    let view = t
        .to_array_view::<f32>()
        .map_err(|e| Error::Other(format!("non-f32 model output: {e}")))?;
    Ok(view.iter().copied().collect())
}

#[inline]
fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

fn l2_normalize(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-8 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Greedy non-maximum suppression by descending score.
fn nms(mut dets: Vec<RawDet>, iou_thresh: f32) -> Vec<RawDet> {
    dets.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut keep: Vec<RawDet> = Vec::new();
    'outer: for d in dets {
        for k in &keep {
            if iou(&d, k) > iou_thresh {
                continue 'outer;
            }
        }
        keep.push(d);
    }
    keep
}

fn iou(a: &RawDet, b: &RawDet) -> f32 {
    let ax2 = a.x + a.w;
    let ay2 = a.y + a.h;
    let bx2 = b.x + b.w;
    let by2 = b.y + b.h;
    let ix = (ax2.min(bx2) - a.x.max(b.x)).max(0.0);
    let iy = (ay2.min(by2) - a.y.max(b.y)).max(0.0);
    let inter = ix * iy;
    let union = a.w * a.h + b.w * b.h - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// Align a face to the 112×112 template using a similarity transform estimated
/// from the 5 landmarks, sampling the source bilinearly. Returns an **RGB**,
/// NCHW, 0..255 buffer of length 3·112·112 ready for SFace — which, unlike the
/// YuNet detector, consumes RGB (OpenCV feeds it with `swapRB=true`).
fn align_crop(img: &RgbImage, src_pts: &[[f32; 2]; 5]) -> Vec<f32> {
    // M maps source→template; invert it to sample template→source.
    let m = umeyama(src_pts, &TEMPLATE);
    let inv = invert_affine(&m);
    let (iw, ih) = (img.width() as i32, img.height() as i32);
    let mut out = vec![0f32; 3 * EMB_SIZE * EMB_SIZE];
    let plane = EMB_SIZE * EMB_SIZE;
    for ty in 0..EMB_SIZE {
        for tx in 0..EMB_SIZE {
            let sx = inv[0] * tx as f32 + inv[1] * ty as f32 + inv[2];
            let sy = inv[3] * tx as f32 + inv[4] * ty as f32 + inv[5];
            let (r, g, b) = sample_bilinear(img, sx, sy, iw, ih);
            let o = ty * EMB_SIZE + tx;
            out[o] = r; // channel 0 = R
            out[plane + o] = g; // channel 1 = G
            out[2 * plane + o] = b; // channel 2 = B
        }
    }
    out
}

fn sample_bilinear(img: &RgbImage, x: f32, y: f32, w: i32, h: i32) -> (f32, f32, f32) {
    if x < 0.0 || y < 0.0 || x > (w - 1) as f32 || y > (h - 1) as f32 {
        return (0.0, 0.0, 0.0);
    }
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let p = |px: i32, py: i32| img.get_pixel(px as u32, py as u32).0;
    let p00 = p(x0, y0);
    let p10 = p(x1, y0);
    let p01 = p(x0, y1);
    let p11 = p(x1, y1);
    let lerp = |a: u8, b: u8, t: f32| a as f32 * (1.0 - t) + b as f32 * t;
    let mut ch = [0f32; 3];
    for c in 0..3 {
        let top = lerp(p00[c], p10[c], fx);
        let bot = lerp(p01[c], p11[c], fx);
        ch[c] = top * (1.0 - fy) + bot * fy;
    }
    (ch[0], ch[1], ch[2])
}

/// Closed-form least-squares fit of a 2D **similarity** transform (uniform
/// scale + rotation + translation, 4 DOF) mapping `src`→`dst`. This is the
/// `estimateAffinePartial2D` OpenCV uses for face alignment, minus the SVD:
/// with the model `x' = a·x − b·y + tx`, `y' = b·x + a·y + ty`, centering the
/// points decouples translation and `(a, b)` have a direct closed form. Returns
/// a 2×3 affine as `[m0, m1, tx, m3, m4, ty]` (x' = m0·x + m1·y + tx …).
fn umeyama(src: &[[f32; 2]; 5], dst: &[[f32; 2]; 5]) -> [f32; 6] {
    let n = src.len() as f32;
    let mean = |p: &[[f32; 2]; 5]| {
        let mut m = [0.0f32; 2];
        for q in p {
            m[0] += q[0];
            m[1] += q[1];
        }
        [m[0] / n, m[1] / n]
    };
    let (ms, md) = (mean(src), mean(dst));
    let mut sxx = 0.0f32; // Σ (xc·uc + yc·vc)
    let mut sxy = 0.0f32; // Σ (xc·vc − yc·uc)
    let mut var = 0.0f32; // Σ (xc² + yc²)
    for i in 0..src.len() {
        let xc = src[i][0] - ms[0];
        let yc = src[i][1] - ms[1];
        let uc = dst[i][0] - md[0];
        let vc = dst[i][1] - md[1];
        sxx += xc * uc + yc * vc;
        sxy += xc * vc - yc * uc;
        var += xc * xc + yc * yc;
    }
    let (a, b) = if var > 1e-12 {
        (sxx / var, sxy / var)
    } else {
        (1.0, 0.0)
    };
    let tx = md[0] - (a * ms[0] - b * ms[1]);
    let ty = md[1] - (b * ms[0] + a * ms[1]);
    [a, -b, tx, b, a, ty]
}

/// Invert a 2×3 affine `[a, b, tx, c, d, ty]`.
fn invert_affine(m: &[f32; 6]) -> [f32; 6] {
    let (a, b, tx, c, d, ty) = (m[0], m[1], m[2], m[3], m[4], m[5]);
    let det = a * d - b * c;
    if det.abs() < 1e-12 {
        // Degenerate; fall back to identity to avoid NaNs.
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    }
    let inv_det = 1.0 / det;
    let ia = d * inv_det;
    let ib = -b * inv_det;
    let ic = -c * inv_det;
    let id = a * inv_det;
    let itx = -(ia * tx + ib * ty);
    let ity = -(ic * tx + id * ty);
    [ia, ib, itx, ic, id, ity]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn umeyama_recovers_known_similarity() {
        // Apply a known rotation+scale+translation to the template, then check
        // that umeyama recovers a transform mapping the moved points back.
        let angle: f32 = 0.4;
        let (ca, sa) = (angle.cos(), angle.sin());
        let scale = 1.7f32;
        let (tx, ty) = (12.0f32, -5.0f32);
        let mut moved = [[0.0f32; 2]; 5];
        for i in 0..5 {
            let x = TEMPLATE[i][0];
            let y = TEMPLATE[i][1];
            moved[i] = [
                scale * (ca * x - sa * y) + tx,
                scale * (sa * x + ca * y) + ty,
            ];
        }
        // Estimate transform moved→template; applying it to moved should return
        // (approximately) the template points.
        let m = umeyama(&moved, &TEMPLATE);
        for i in 0..5 {
            let x = m[0] * moved[i][0] + m[1] * moved[i][1] + m[2];
            let y = m[3] * moved[i][0] + m[4] * moved[i][1] + m[5];
            assert!((x - TEMPLATE[i][0]).abs() < 1e-2, "x[{i}] = {x}");
            assert!((y - TEMPLATE[i][1]).abs() < 1e-2, "y[{i}] = {y}");
        }
    }

    #[test]
    fn invert_affine_roundtrips() {
        let m = [1.3, -0.2, 4.0, 0.15, 1.1, -3.0];
        let inv = invert_affine(&m);
        // Composing m then inv on a point returns the point.
        let (px, py) = (7.0f32, -2.5f32);
        let mx = m[0] * px + m[1] * py + m[2];
        let my = m[3] * px + m[4] * py + m[5];
        let bx = inv[0] * mx + inv[1] * my + inv[2];
        let by = inv[3] * mx + inv[4] * my + inv[5];
        assert!((bx - px).abs() < 1e-3);
        assert!((by - py).abs() < 1e-3);
    }

    #[test]
    fn nms_suppresses_overlap() {
        let mk = |x: f32, s: f32| RawDet {
            x,
            y: 0.0,
            w: 10.0,
            h: 10.0,
            score: s,
            landmarks: [[0.0; 2]; 5],
        };
        let kept = nms(vec![mk(0.0, 0.9), mk(1.0, 0.8), mk(100.0, 0.7)], 0.3);
        assert_eq!(kept.len(), 2); // the two overlapping boxes collapse to one
    }
}
