-- Free, bounded D1 photo storage for testing without an R2 subscription.
-- Not a replacement for production-scale object storage.
CREATE TABLE IF NOT EXISTS trial_image_objects (
 object_key TEXT PRIMARY KEY,
 content_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 524288),
 data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_image_objects_prefix ON trial_image_objects(object_key);
