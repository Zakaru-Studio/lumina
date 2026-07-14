//! Integration tests exercising the database, search (FTS5), tags and album
//! logic end-to-end against a temporary SQLite database.

use lumina_lib::core::models::{MediaType, Photo, ThumbStatus};
use lumina_lib::core::query::{PhotoFilter, PhotoQuery, SortBy, SortDir};
use lumina_lib::database::{albums, photos, tags, Database};

/// Open a throwaway database in a temp dir with migrations applied.
fn temp_db() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("test.db");
    let db = Database::open(&path, 4, 1_700_000_000).expect("open db");
    (dir, db)
}

fn sample_photo(id: &str, path: &str, filename: &str) -> Photo {
    Photo {
        id: id.to_string(),
        path: path.to_string(),
        filename: filename.to_string(),
        folder: "/photos".to_string(),
        format: "jpeg".to_string(),
        media_type: MediaType::Photo,
        taken_at: Some(1_700_000_000),
        file_created: Some(1_699_000_000),
        file_modified: Some(1_699_000_000),
        imported_at: 1_700_000_100,
        width: 4000,
        height: 3000,
        orientation: 1,
        file_size: 1_234_567,
        camera_make: Some("Nikon".to_string()),
        camera_model: Some("Z6".to_string()),
        lens: Some("50mm f/1.8".to_string()),
        iso: Some(100),
        focal_length: Some(50.0),
        aperture: Some(1.8),
        shutter_speed: Some("1/250".to_string()),
        gps_lat: None,
        gps_lon: None,
        hash: Some("deadbeef".to_string()),
        rating: 0,
        is_favorite: false,
        is_raw: false,
        thumb_status: ThumbStatus::Ready,
        thumb_path: Some("/cache/aa/x.webp".to_string()),
        tags: vec![],
    }
}

#[test]
fn insert_list_and_count() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();

    photos::upsert(&conn, &sample_photo("id-1", "/photos/a.jpg", "beach.jpg")).unwrap();
    photos::upsert(&conn, &sample_photo("id-2", "/photos/b.jpg", "mountain.jpg")).unwrap();

    let page = photos::list(&conn, &PhotoQuery::default()).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.items.len(), 2);

    let n = photos::count(&conn, &PhotoFilter::default()).unwrap();
    assert_eq!(n, 2);
}

#[test]
fn upsert_is_idempotent_by_path() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    photos::upsert(&conn, &sample_photo("id-1", "/photos/a.jpg", "a.jpg")).unwrap();
    // Same path, different id — should update, not duplicate.
    photos::upsert(&conn, &sample_photo("id-2", "/photos/a.jpg", "renamed.jpg")).unwrap();
    let page = photos::list(&conn, &PhotoQuery::default()).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].filename, "renamed.jpg");
}

#[test]
fn overridden_capture_date_survives_rescan() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();

    // Initial index: taken_at from the file.
    let mut p = sample_photo("id-1", "/photos/a.jpg", "a.jpg");
    p.taken_at = Some(3_600_000_000); // a wrong, far-future date
    photos::upsert(&conn, &p).unwrap();

    // User corrects the date (catalog override).
    let corrected = 1_245_069_000; // 2009
    photos::set_taken_at(&conn, "id-1", corrected, p.file_size, p.file_modified).unwrap();
    assert_eq!(photos::get(&conn, "id-1").unwrap().taken_at, Some(corrected));

    // A rescan re-upserts the same path with the file's (still wrong) date.
    // The override must win.
    let mut rescanned = p.clone();
    rescanned.taken_at = Some(3_600_000_000);
    photos::upsert(&conn, &rescanned).unwrap();
    assert_eq!(
        photos::get(&conn, "id-1").unwrap().taken_at,
        Some(corrected),
        "overridden date must be preserved across a rescan"
    );

    // A non-overridden photo is still updated normally by a rescan.
    let mut q = sample_photo("id-2", "/photos/b.jpg", "b.jpg");
    q.taken_at = Some(1_000_000_000);
    photos::upsert(&conn, &q).unwrap();
    q.taken_at = Some(1_500_000_000);
    photos::upsert(&conn, &q).unwrap();
    assert_eq!(photos::get(&conn, "id-2").unwrap().taken_at, Some(1_500_000_000));
}

#[test]
fn full_text_search_matches_filename_and_camera() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    photos::upsert(&conn, &sample_photo("id-1", "/photos/a.jpg", "beach-sunset.jpg")).unwrap();
    photos::upsert(&conn, &sample_photo("id-2", "/photos/b.jpg", "forest.jpg")).unwrap();

    let mut q = PhotoQuery::default();
    q.filter.text = Some("beach".to_string());
    let page = photos::list(&conn, &q).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, "id-1");

    // Camera model is indexed too.
    let mut q2 = PhotoQuery::default();
    q2.filter.text = Some("nikon".to_string());
    assert_eq!(photos::list(&conn, &q2).unwrap().total, 2);
}

#[test]
fn ratings_favorites_and_soft_delete_are_non_destructive() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    photos::upsert(&conn, &sample_photo("id-1", "/photos/a.jpg", "a.jpg")).unwrap();

    photos::set_rating(&conn, &["id-1".into()], 5).unwrap();
    photos::set_favorite(&conn, &["id-1".into()], true).unwrap();

    let p = photos::get(&conn, "id-1").unwrap();
    assert_eq!(p.rating, 5);
    assert!(p.is_favorite);

    let removed = photos::soft_delete(&conn, &["id-1".into()], 1_700_000_200).unwrap();
    assert_eq!(removed, 1);
    // Gone from the live catalog...
    assert_eq!(photos::count(&conn, &PhotoFilter::default()).unwrap(), 0);
    // ...but get() reports NotFound rather than crashing.
    assert!(photos::get(&conn, "id-1").is_err());
}

#[test]
fn tag_lifecycle_and_filtering() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    photos::upsert(&conn, &sample_photo("id-1", "/photos/a.jpg", "a.jpg")).unwrap();
    photos::upsert(&conn, &sample_photo("id-2", "/photos/b.jpg", "b.jpg")).unwrap();

    let tag = tags::create(&conn, "Travel", None, 1_700_000_000).unwrap();
    tags::attach(&conn, &tag.id, &["id-1".into()], 1_700_000_000).unwrap();

    // Photo detail includes the tag.
    let p = photos::get(&conn, "id-1").unwrap();
    assert_eq!(p.tags, vec!["Travel".to_string()]);

    // Filter by tag returns only the tagged photo.
    let mut q = PhotoQuery::default();
    q.filter.tags = vec!["Travel".to_string()];
    assert_eq!(photos::list(&conn, &q).unwrap().total, 1);

    // Tag list reports a live count.
    let listed = tags::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].count, 1);

    // Detach removes the association.
    tags::detach(&conn, &tag.id, &["id-1".into()]).unwrap();
    assert_eq!(photos::get(&conn, "id-1").unwrap().tags.len(), 0);
}

#[test]
fn smart_albums_are_seeded() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    let list = albums::list(&conn, 1_700_000_000).unwrap();
    // Seven built-in smart albums (Today, Week, Month, Favorites, RAW, Videos,
    // Duplicates).
    let smart = list.iter().filter(|a| a.rule.is_some()).count();
    assert_eq!(smart, 7);
}

#[test]
fn get_album_reports_live_count() {
    // Regression: `albums::get` used to return `count: 0`, so an album's header
    // (fed by get_album) showed the wrong number — notably on the Duplicates
    // page. get() must evaluate the count the same way list() does.
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    let now = 1_700_000_000;

    // Two photos share a hash (a duplicate pair); a third is unique.
    let mut a = sample_photo("id-1", "/photos/a.jpg", "a.jpg");
    a.hash = Some("dup".into());
    let mut b = sample_photo("id-2", "/photos/b.jpg", "b.jpg");
    b.hash = Some("dup".into());
    let mut c = sample_photo("id-3", "/photos/c.jpg", "c.jpg");
    c.hash = Some("unique".into());
    photos::upsert(&conn, &a).unwrap();
    photos::upsert(&conn, &b).unwrap();
    photos::upsert(&conn, &c).unwrap();

    // Smart album: Duplicates. get()'s count must match list()'s and equal 2.
    let list = albums::list(&conn, now).unwrap();
    let dup = list
        .iter()
        .find(|al| albums::preset_of(al) == Some("duplicates"))
        .expect("duplicates album seeded");
    assert_eq!(dup.count, 2, "list() duplicates count");
    let dup_get = albums::get(&conn, &dup.id, now).unwrap();
    assert_eq!(dup_get.count, 2, "get() duplicates count");

    // Manual album: get()'s count reflects membership, not 0.
    let manual = albums::create(&conn, "Trip", None, now).unwrap();
    albums::add_photos(&conn, &manual.id, &["id-3".into()], now).unwrap();
    let manual_get = albums::get(&conn, &manual.id, now).unwrap();
    assert_eq!(manual_get.count, 1, "get() manual count");
}

#[test]
fn duplicates_listing_honors_query_sort() {
    // The Duplicates view now sorts like the library. Two duplicate pairs with
    // distinct file sizes must order by the requested key/direction, while the
    // copies of each pair stay adjacent (hash tie-break).
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();

    let make = |id: &str, hash: &str, size: i64| {
        let mut p = sample_photo(id, &format!("/photos/{id}.jpg"), &format!("{id}.jpg"));
        p.hash = Some(hash.into());
        p.file_size = size;
        photos::upsert(&conn, &p).unwrap();
    };
    make("a1", "aaa", 100);
    make("a2", "aaa", 100);
    make("b1", "bbb", 200);
    make("b2", "bbb", 200);

    let by_size = |dir: SortDir| {
        let q = PhotoQuery {
            sort_by: SortBy::FileSize,
            sort_dir: dir,
            ..PhotoQuery::default()
        };
        let page = photos::duplicates(&conn, &q).unwrap();
        assert_eq!(page.total, 4);
        page.items.iter().map(|p| p.file_size).collect::<Vec<_>>()
    };

    assert_eq!(by_size(SortDir::Asc), vec![100, 100, 200, 200], "ascending by size");
    assert_eq!(by_size(SortDir::Desc), vec![200, 200, 100, 100], "descending by size");

    // Copies of each hash group remain contiguous regardless of direction.
    let q = PhotoQuery {
        sort_by: SortBy::FileSize,
        sort_dir: SortDir::Asc,
        ..PhotoQuery::default()
    };
    let hashes = photos::duplicates(&conn, &q)
        .unwrap()
        .items
        .iter()
        .map(|p| p.hash.clone().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(hashes, vec!["aaa", "aaa", "bbb", "bbb"]);
}

#[test]
fn dedupe_plan_picks_best_keeper() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();

    // Group 1 (hash g1): metadata must win over a cleaner name / older import.
    let mut a = sample_photo("a", "/photos/IMG (1).jpg", "IMG (1).jpg");
    a.hash = Some("g1".into());
    a.imported_at = 100;
    let mut b = sample_photo("b", "/photos/IMG.jpg", "IMG.jpg"); // clean + oldest
    b.hash = Some("g1".into());
    b.imported_at = 90;
    let mut c = sample_photo("c", "/photos/IMG-copy.jpg", "IMG-copy.jpg");
    c.hash = Some("g1".into());
    c.rating = 5; // richest metadata → should be kept despite "copy" in name
    c.imported_at = 110;

    // Group 2 (hash g2): no metadata, so the cleaner filename wins.
    let mut d = sample_photo("d", "/p/pic (2).png", "pic (2).png");
    d.hash = Some("g2".into());
    let mut e = sample_photo("e", "/p/pic.png", "pic.png"); // clean name
    e.hash = Some("g2".into());

    for p in [&a, &b, &c, &d, &e] {
        photos::upsert(&conn, p).unwrap();
    }

    let plan = photos::dedupe_plan(&conn, None).unwrap();
    assert_eq!(plan.total_remove, 3, "a, b and d are redundant");
    assert_eq!(plan.groups.len(), 2);

    // BTreeMap orders groups by hash: g1 then g2.
    assert_eq!(plan.groups[0].keep.id, "c", "richest metadata kept");
    let mut removed: Vec<_> = plan.groups[0].remove.iter().map(|p| p.id.clone()).collect();
    removed.sort();
    assert_eq!(removed, vec!["a", "b"]);

    assert_eq!(plan.groups[1].keep.id, "e", "cleaner filename kept");
    assert_eq!(plan.groups[1].remove.len(), 1);
    assert_eq!(plan.groups[1].remove[0].id, "d");

    // Scoped to a selection: only the g1 copies are in scope, so only that group
    // appears. A selection containing just one copy of a pair (here only "d" of
    // g2) yields no removals for that group.
    let sel = ["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string()];
    let scoped = photos::dedupe_plan(&conn, Some(&sel)).unwrap();
    assert_eq!(scoped.groups.len(), 1, "only g1 has >=2 selected copies");
    assert_eq!(scoped.total_remove, 2);
    assert_eq!(scoped.groups[0].keep.id, "c");
}

#[test]
fn smart_album_favorites_filter() {
    let (_dir, db) = temp_db();
    let conn = db.get().unwrap();
    let mut fav = sample_photo("id-1", "/photos/a.jpg", "a.jpg");
    fav.is_favorite = true;
    photos::upsert(&conn, &fav).unwrap();
    photos::upsert(&conn, &sample_photo("id-2", "/photos/b.jpg", "b.jpg")).unwrap();

    let filter = albums::resolve_smart_filter(
        &serde_json::json!({ "preset": "favorites" }),
        1_700_000_000,
    );
    assert_eq!(photos::count(&conn, &filter).unwrap(), 1);
}
