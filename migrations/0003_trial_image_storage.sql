-- Free trial image storage, separate from catalog metadata.
CREATE TABLE IF NOT EXISTS trial_image_objects (
  object_key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 524288),
  data BLOB NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trial_image_capacity
BEFORE INSERT ON trial_image_objects
WHEN (SELECT COALESCE(SUM(size_bytes),0) FROM trial_image_objects) + NEW.size_bytes > 33554432
BEGIN
  SELECT RAISE(ABORT,'Trial image capacity reached');
END;
