/**
 * Where the app entry route should send someone, given the session status.
 *
 * Pure and separate from the screen so the rule is assertable in a unit test
 * rather than only observable by launching the app. The three-way return
 * matters: 'wait' is not "logged out", and collapsing it into a redirect is
 * how a returning user ends up seeing the login screen flash before their
 * own data loads.
 */
import type { AuthStatus } from "@/stores";

export type GateDestination =
  /** Session still hydrating — hold on the entry screen. */
  { kind: "wait" } | { kind: "redirect"; href: "/(tabs)" | "/login" };

export function resolveGate(status: AuthStatus): GateDestination {
  switch (status) {
    case "unknown":
      return { kind: "wait" };
    case "authenticated":
      return { kind: "redirect", href: "/(tabs)" };
    case "unauthenticated":
      return { kind: "redirect", href: "/login" };
  }
}
