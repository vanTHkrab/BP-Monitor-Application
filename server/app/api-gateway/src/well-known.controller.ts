import { Controller, Get, Header, NotFoundException } from '@nestjs/common';

/**
 * Digital Asset Links, for passkeys on Android.
 *
 * Android will not let the app use a passkey scoped to `PASSKEY_RP_ID` unless
 * that domain publicly vouches for the app's signing certificate at
 * `https://<domain>/.well-known/assetlinks.json`. The file is fetched by
 * Google's servers, not by the app, so it has to be reachable without auth
 * and over real HTTPS.
 *
 * **It must be served from the RP domain itself.** If the gateway lives at
 * `api.example.com` while `PASSKEY_RP_ID` is `example.com`, this route is on
 * the wrong host and Android ignores it — the file has to be published at
 * `example.com` by whatever serves that domain. Serving it here covers the
 * case where the two are the same host, which is the simplest deployment and
 * the one this project documents.
 *
 * Nothing here is a secret: a signing certificate's SHA-256 fingerprint is
 * public by design, and the whole point of the file is that anyone can read it.
 */
@Controller('.well-known')
export class WellKnownController {
  @Get('assetlinks.json')
  // Cached, because Google refetches it and a per-request rebuild of a static
  // document is waste. Short enough that rotating a signing key is not a
  // day-long outage.
  @Header('Cache-Control', 'public, max-age=3600')
  getAssetLinks() {
    const packageName =
      process.env.ANDROID_APP_PACKAGE_NAME?.trim() || 'com.project.bpmobile';
    const fingerprints = (process.env.ANDROID_APP_SHA256_FINGERPRINT ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    // A file listing zero certificates is worse than no file: Android reads it
    // as a definitive "this domain vouches for nobody" rather than as missing
    // configuration, and the failure surfaces as an unexplained passkey error
    // on the device.
    if (fingerprints.length === 0) {
      throw new NotFoundException();
    }

    return [
      {
        // Both relations on purpose. `get_login_creds` is what passkeys and
        // Credential Manager need; `handle_all_urls` is what App Links need.
        // Declaring only the first works today and silently breaks deep links
        // the first time someone adds one.
        relation: [
          'delegate_permission/common.get_login_creds',
          'delegate_permission/common.handle_all_urls',
        ],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          // Plural because debug and release builds are signed differently,
          // and Play App Signing re-signs the upload with a third key. All of
          // them have to be listed or passkeys work on exactly one of the
          // three builds.
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ];
  }
}
