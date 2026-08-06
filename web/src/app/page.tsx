import { redirect } from "next/navigation";

/**
 * The docs are what this site is for, so `/` goes straight to them.
 *
 * This replaced an unmodified shadcn login template — still branded "Acme
 * Inc." and wired to nothing — which had sat at the root since scaffolding.
 * It was not a login: no auth library was installed and no route was guarded
 * by it, so it only made the app look protected. Access control for the
 * service-status pages under `/admin` is a network-layer concern; see
 * `docs/guides/deploy.md`.
 */
export default function RootPage() {
    redirect("/docs");
}
