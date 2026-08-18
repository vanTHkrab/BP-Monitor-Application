package expo.modules.bpvision

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.util.Log

private const val TAG = "BPVisionImageDecode"

/**
 * The one place a file becomes a bitmap for this module, and the owner of the
 * invariant **"the pixels handed to the pipeline are upright"**.
 *
 * ## Nothing currently reaching this module carries an EXIF orientation
 *
 * That is worth stating plainly, because the obvious reading of this file —
 * "there must be a producer writing rotated pixels plus an orientation tag" —
 * is not true today. Two facts make it so, and both are choices rather than
 * guarantees:
 *
 *  - **The capture path.** `CameraController.kt::writeUprightJpeg` bakes the
 *    sensor rotation into the pixels and writes the file with
 *    `Bitmap.compress`, which emits no EXIF block at all. No tag, at any
 *    image size. (When expo-camera is the capture surface instead, nothing
 *    reaches this module either: `bp-camera-view.tsx`'s `USE_NATIVE_CAMERA` is
 *    `Platform.OS === 'android' && isBpVisionAvailable()`, so expo-camera is
 *    only in play precisely when this native module is not linked.)
 *  - **The gallery path.** `camera.tsx` calls `launchImageLibraryAsync` with
 *    **`quality: 0.8`**. Because that is not `MAXIMUM_QUALITY` (1.0),
 *    expo-image-picker picks `CompressionImageExporter`, which decodes through
 *    Glide (orientation applied), re-encodes with `Bitmap.compress`, and then
 *    copies the source EXIF with `TAG_ORIENTATION` in its *omitted* list.
 *    Upright pixels, and the tag deliberately not carried over.
 *
 * There is therefore no double-rotation trap today either — the usual next
 * worry. The picker strips the tag rather than leaving it sitting beside
 * pixels it has already rotated, so applying orientation here cannot rotate
 * the same image twice.
 *
 * ## Why this exists anyway
 *
 * Because both facts above are one edit away from changing, and the failure is
 * silent. Set that `quality` to `1` and expo-image-picker switches to
 * `RawImageExporter`, which copies the chosen file byte for byte — EXIF and
 * all. A share-sheet intake, a document picker, or a future capture path that
 * writes its own metadata would do the same.
 *
 * What that would cost is a divergence between two engines that are required
 * to agree. The backend has no such hole: `cv2.imdecode(IMREAD_COLOR)` applies
 * EXIF orientation. So an EXIF-rotated file would be read sideways here — zero
 * fields, reported to the patient as "unreadable" — while the very same bytes
 * read fine server-side. That is exactly the class of drift `AGENTS.md` rule 5
 * exists to prevent, and it would be invisible until someone compared an
 * offline prefill against what the sync came back with.
 *
 * Centralising the decode is what makes that unreachable: a new producer
 * cannot reintroduce the divergence without going through here. The
 * `quality: 0.8` above is named on purpose, so changing it stays a visible
 * decision rather than a silent regression.
 *
 * Doing it at the decode rather than by forcing a re-encode in
 * `image-prepare.ts` is deliberate on two counts: a forced re-encode would
 * spend a generation of JPEG loss on images that need no resize, and it would
 * only ever cover files that happen to pass through that one function.
 */
internal object ImageDecode {

  /**
   * Decode [path] and return it with any EXIF orientation applied, so the
   * caller always receives pixels in display orientation.
   *
   * Returns `null` only when the file cannot be decoded at all — the same
   * contract `BitmapFactory.decodeFile` had, so callers keep their existing
   * "decode-failed" branches.
   *
   * Uses `android.media.ExifInterface` rather than `androidx.exifinterface`:
   * the androidx artifact is not on this module's compile classpath (CameraX
   * pulls it in only as a transitive `implementation` dependency, which Gradle
   * does not expose to consumers), and adding a dependency to normalise a
   * rotation is not a trade this fix needs to make. The platform class has
   * read the orientation tag since API 5 and defines the mirrored constants
   * since API 24, which is this module's `minSdkVersion`.
   *
   * Formats without an EXIF block (PNG, WebP) simply report
   * `ORIENTATION_NORMAL` and take the identity path — correct, because there
   * is no orientation to apply.
   */
  fun decodeUpright(path: String): Bitmap? {
    val decoded = BitmapFactory.decodeFile(path) ?: return null

    val orientation = readOrientation(path)
    val matrix = matrixFor(orientation) ?: return decoded

    return try {
      val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
      // `createBitmap` hands back the source itself when the transform turns
      // out to be a no-op. Recycling it in that case would free the bitmap we
      // are about to return.
      if (upright !== decoded) decoded.recycle()
      upright
    } catch (e: Throwable) {
      // Rotating materialises a second full-size bitmap, so OutOfMemoryError
      // is the realistic failure here, and it is an Error rather than an
      // Exception — hence Throwable. A sideways image still gives the backend
      // something to read on sync; a crashed capture gives nobody anything.
      Log.w(TAG, "decodeUpright: could not apply EXIF orientation $orientation", e)
      decoded
    }
  }

  /** `ORIENTATION_NORMAL` when the tag is absent or the file cannot be read. */
  private fun readOrientation(path: String): Int = try {
    ExifInterface(path).getAttributeInt(
      ExifInterface.TAG_ORIENTATION,
      ExifInterface.ORIENTATION_NORMAL,
    )
  } catch (e: Throwable) {
    // Any failure to read metadata means "no orientation known", which is the
    // same outcome as a file that has none. Not silent: it is logged, because
    // it would otherwise look identical to a genuinely upright photo.
    Log.w(TAG, "decodeUpright: could not read EXIF from '$path'", e)
    ExifInterface.ORIENTATION_NORMAL
  }

  /**
   * The transform that takes stored pixels to display orientation, or `null`
   * when there is nothing to do.
   *
   * All eight EXIF orientation values are handled, including the four
   * mirrored ones. They are rare from phone cameras but entirely reachable
   * from a gallery pick — a front-camera selfie saved by some OEM camera apps,
   * or anything that has been through an editor — and a mirrored BP display
   * reads as digits the recogniser has never seen. `ORIENTATION_UNDEFINED`
   * and any unknown value fall through to `null`: an orientation we cannot
   * name is not one we should guess at.
   */
  private fun matrixFor(orientation: Int): Matrix? {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
        matrix.setRotate(180f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      // ORIENTATION_NORMAL, ORIENTATION_UNDEFINED, anything unrecognised.
      else -> return null
    }
    return matrix
  }
}
