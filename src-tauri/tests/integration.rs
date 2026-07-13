//! Integration tests exercising the database, search (FTS5), tags and album
//! logic end-to-end against a temporary SQLite database.

use lumina_lib::core::models::{ColorLabel, MediaType, Photo, ThumbStatus};
use lumina_lib::core::query::{PhotoFilter, PhotoQuery};
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
        color_label: ColorLabel::None,
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
    photos::set_color(&conn, &["id-1".into()], ColorLabel::Red).unwrap();

    let p = photos::get(&conn, "id-1").unwrap();
    assert_eq!(p.rating, 5);
    assert!(p.is_favorite);
    assert_eq!(p.color_label, ColorLabel::Red);

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
    // Six built-in smart albums.
    let smart = list.iter().filter(|a| a.rule.is_some()).count();
    assert_eq!(smart, 6);
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
