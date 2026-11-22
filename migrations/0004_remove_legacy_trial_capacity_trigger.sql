-- Earlier duplicate 0003 migration could have created a conflicting 32 MiB trigger.
-- Application storage adapter enforces its own capacity limit.
DROP TRIGGER IF EXISTS trial_image_capacity;
