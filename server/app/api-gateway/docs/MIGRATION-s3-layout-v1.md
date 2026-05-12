# S3 layout migration — legacy → v1

One-off migration moving every object out of the legacy feature-rooted
prefixes into the user-rooted layout defined in
[`src/storage/types/storage.types.ts`](../src/storage/types/storage.types.ts).

## Layout diff

| Old key | New key |
| --- | --- |
| `app/profile-images/{userId}/{YYYY-MM-DD}/{uuid}.{ext}` | `users/{userId}/profile/avatar/{uuid}.{ext}` |
| `app/profile-images/{userId}/pending/{uuid}.{ext}` | `tmp/{userId}/{uuid}.{ext}` |
| `training/blood-pressure-meter-images/{userId}/{YYYY-MM-DD}/{uuid}.{ext}` | `users/{userId}/bp/readings/{YYYY-MM}/{uuid}.{ext}` |
| `training/blood-pressure-meter-images/{userId}/pending/{uuid}.{ext}` | `tmp/{userId}/{uuid}.{ext}` |
| `blood-pressure-meter-images/{userId}/...` (older variant) | `users/{userId}/bp/readings/{YYYY-MM}/{uuid}.{ext}` |
| `profiles/{userId}/...` (older variant) | `users/{userId}/profile/avatar/{uuid}.{ext}` |

Notes:

- Daily partitioning (`YYYY-MM-DD`) collapses to monthly (`YYYY-MM`). Pick
  the destination month from the source object's `LastModified` date.
- Pending objects under the old `pending/` segment may have been left
  behind by aborted uploads — they are safe to discard rather than
  migrate. The lifecycle rule on the new `tmp/` prefix expires them in
  one day anyway.

## Why now

The application has not launched, so a **single hard cut-over** is the
right move:

- No production traffic to rollback for.
- No need for dual-write / dual-read shims.
- One PR contains code + script + DB backfill.

If a future migration happens after launch, use dual-write + dual-read +
backfill + cut-read pattern instead.

## Migration steps

### 1. Deploy code

The code in this branch already writes new objects to the v1 layout.
Legacy prefixes are still in `ALLOWED_IMAGE_PREFIXES` so existing
`/storage/image?key=...` requests keep working until the copy completes.

After deploy, **no new objects** land in the legacy paths.

### 2. Copy S3 objects (script below)

Run once against each environment's bucket. The script is idempotent
(skips objects that already exist at the destination) and dry-run by
default.

```bash
# Dry-run first — prints would-be copies but doesn't touch S3.
node scripts/migrate-s3-layout.mjs --bucket bp-monitor-dev --dry-run

# Real run.
node scripts/migrate-s3-layout.mjs --bucket bp-monitor-dev
```

After every object is copied, **leave the originals in place** — DB
backfill (step 3) needs the old keys to still exist if any sanity
check has to re-resolve them. Originals get deleted in step 5.

### 3. Backfill `image_url` columns

Two tables hold S3 keys:

- `blood_pressure_readings.image_uri` (nullable string)
- `images.image_url` (string)

Run the migration that ships with this branch:

```bash
pnpm prisma migrate dev --name s3_layout_v1_backfill
```

The migration's SQL (templated below — drop into
`prisma/migrations/{timestamp}_s3_layout_v1_backfill/migration.sql`):

```sql
-- Convert old BP keys → new monthly-partitioned keys.
-- Maps:
--   training/blood-pressure-meter-images/{userId}/{YYYY-MM-DD}/{uuid}.{ext}
--   → users/{userId}/bp/readings/{YYYY-MM}/{uuid}.{ext}
UPDATE blood_pressure_readings
SET image_uri = regexp_replace(
  image_uri,
  '^(?:training/)?blood-pressure-meter-images/([^/]+)/(\d{4}-\d{2})-\d{2}/(.+)$',
  'users/\1/bp/readings/\2/\3'
)
WHERE image_uri ~ '^(?:training/)?blood-pressure-meter-images/';

UPDATE images
SET image_url = regexp_replace(
  image_url,
  '^(?:training/)?blood-pressure-meter-images/([^/]+)/(\d{4}-\d{2})-\d{2}/(.+)$',
  'users/\1/bp/readings/\2/\3'
)
WHERE image_url ~ '^(?:training/)?blood-pressure-meter-images/';

-- Profile avatars: drop the date segment entirely.
--   app/profile-images/{userId}/{YYYY-MM-DD}/{uuid}.{ext}
--   → users/{userId}/profile/avatar/{uuid}.{ext}
UPDATE users
SET avatar = regexp_replace(
  avatar,
  '^(?:app/profile-images|profiles)/([^/]+)/\d{4}-\d{2}-\d{2}/(.+)$',
  'users/\1/profile/avatar/\2'
)
WHERE avatar ~ '^(?:app/profile-images|profiles)/';
```

### 4. Smoke test

- Open the mobile app, view a user's history → BP photos render.
- Open the web dashboard → profile avatars render.
- Try a new upload (profile avatar + BP reading) → confirm new objects
  land at the new prefixes.
- Hit the `analyzeBPImage` mutation with a freshly-uploaded key →
  AI service responds.

### 5. Drop legacy prefixes + delete old objects

Once the smoke test passes:

1. Remove the legacy entries from `ALLOWED_IMAGE_PREFIXES` in
   [`storage.types.ts`](../src/storage/types/storage.types.ts).
2. Remove the legacy fallbacks from `resolveBloodPressurePrefix` in
   [`storage.service.ts`](../src/storage/storage.service.ts).
3. Run a delete-by-prefix on the old roots:

```bash
aws s3 rm --recursive s3://bp-monitor-dev/app/profile-images/
aws s3 rm --recursive s3://bp-monitor-dev/training/blood-pressure-meter-images/
aws s3 rm --recursive s3://bp-monitor-dev/blood-pressure-meter-images/
aws s3 rm --recursive s3://bp-monitor-dev/profiles/
```

## Lifecycle rules to add (DevOps)

Set these on each bucket after the cut-over:

| Prefix | Rule |
| --- | --- |
| `tmp/` | Expire 1 day |
| `users/*/exports/` | Expire 30 days |
| `users/*/bp/readings/` | Standard → Standard-IA at 90 days → Glacier at 365 days |

## Bucket access posture

After migration:

- **Block Public Access**: ON for `users/`, `tmp/`, `training/`.
- **Public CDN origin** allowed only for `app/static/*` and
  `app/defaults/*` (system assets, no PII).
- Every URL the client renders for user data goes through either:
  - A presigned GET URL the gateway mints, or
  - The gateway's `/storage/image?key=...` stream endpoint (auth-gated).

## Migration script (TypeScript / Node)

Save to `scripts/migrate-s3-layout.mjs`. Uses the AWS SDK that's already
on the gateway:

```js
// scripts/migrate-s3-layout.mjs
//
// One-off S3 layout migration. Idempotent: skips if the destination
// object already exists. Dry-run with --dry-run.
//
// Usage:
//   node scripts/migrate-s3-layout.mjs --bucket bp-monitor-dev [--dry-run]
//
// Env: reads S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY /
//      S3_DEFAULT_REGION / S3_USE_PATH_STYLE_ENDPOINT (same as gateway).

import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const args = new Map(
  process.argv
    .slice(2)
    .map((a) => (a.includes('=') ? a.split('=') : [a, true])),
);
const BUCKET = args.get('--bucket');
const DRY_RUN = Boolean(args.get('--dry-run'));
if (!BUCKET) {
  console.error('--bucket is required');
  process.exit(1);
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_DEFAULT_REGION || 'auto',
  forcePathStyle: process.env.S3_USE_PATH_STYLE_ENDPOINT === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

// (sourcePrefix, mapper) — mapper returns the new key or null to skip.
const RULES = [
  // BP readings (legacy with training/ root)
  {
    prefix: 'training/blood-pressure-meter-images/',
    map: (key) => {
      // training/blood-pressure-meter-images/{userId}/{YYYY-MM-DD}/{file}
      // or         .../{userId}/pending/{file}  → discard (lifecycle handles tmp).
      const m = key.match(
        /^training\/blood-pressure-meter-images\/([^/]+)\/(\d{4}-\d{2})-\d{2}\/(.+)$/,
      );
      if (!m) return null;
      const [, userId, ym, file] = m;
      return `users/${userId}/bp/readings/${ym}/${file}`;
    },
  },
  // BP readings (older variant without training/)
  {
    prefix: 'blood-pressure-meter-images/',
    map: (key) => {
      const m = key.match(
        /^blood-pressure-meter-images\/([^/]+)\/(\d{4}-\d{2})-\d{2}\/(.+)$/,
      );
      if (!m) return null;
      const [, userId, ym, file] = m;
      return `users/${userId}/bp/readings/${ym}/${file}`;
    },
  },
  // Profile avatars
  {
    prefix: 'app/profile-images/',
    map: (key) => {
      const m = key.match(
        /^app\/profile-images\/([^/]+)\/\d{4}-\d{2}-\d{2}\/(.+)$/,
      );
      if (!m) return null;
      const [, userId, file] = m;
      return `users/${userId}/profile/avatar/${file}`;
    },
  },
  // Profile avatars (older variant)
  {
    prefix: 'profiles/',
    map: (key) => {
      const m = key.match(/^profiles\/([^/]+)\/\d{4}-\d{2}-\d{2}\/(.+)$/);
      if (!m) return null;
      const [, userId, file] = m;
      return `users/${userId}/profile/avatar/${file}`;
    },
  },
];

async function destinationExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function copyOne(sourceKey, destKey) {
  if (await destinationExists(destKey)) {
    console.log(`skip exists  ${sourceKey} → ${destKey}`);
    return 'skipped';
  }
  if (DRY_RUN) {
    console.log(`would copy   ${sourceKey} → ${destKey}`);
    return 'dry-run';
  }
  await client.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      Key: destKey,
      CopySource: `/${BUCKET}/${encodeURIComponent(sourceKey)}`,
    }),
  );
  console.log(`copied       ${sourceKey} → ${destKey}`);
  return 'copied';
}

async function migrate(rule) {
  let token;
  let copied = 0;
  let skipped = 0;
  let discarded = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: rule.prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      const dest = rule.map(obj.Key);
      if (!dest) {
        discarded += 1;
        continue;
      }
      const result = await copyOne(obj.Key, dest);
      if (result === 'copied') copied += 1;
      else if (result === 'skipped') skipped += 1;
    }
    token = page.NextContinuationToken;
  } while (token);
  console.log(
    `rule ${rule.prefix}: copied=${copied} skipped=${skipped} discarded=${discarded}`,
  );
}

for (const rule of RULES) await migrate(rule);
console.log(DRY_RUN ? 'Dry run complete.' : 'Migration complete.');
```

## Rollback

If smoke test (step 4) fails:

1. **Don't run step 5** — originals are still in place.
2. Revert the deployed code to the previous commit.
3. Revert the Prisma migration (the script is forward-only; write a
   reverse migration that undoes the regex replacement, or restore
   from snapshot).
4. The copied-but-unused new objects can stay in S3 — they don't hurt
   anything until they're referenced. Optionally delete:
   `aws s3 rm --recursive s3://{bucket}/users/`

## Cut-over checklist

- [ ] Code deployed (this branch)
- [ ] S3 copy script ran successfully (dry-run reviewed first)
- [ ] Prisma migration applied
- [ ] Smoke test passed
- [ ] Lifecycle rules added on bucket
- [ ] Legacy entries removed from `ALLOWED_IMAGE_PREFIXES`
- [ ] Old S3 prefixes deleted
- [ ] PR 4 deprecation cleanup (legacy `uploadProfileImage` etc) opened
