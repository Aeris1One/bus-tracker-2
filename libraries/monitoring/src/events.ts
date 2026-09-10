import type { PostHog } from "posthog-node";

export function captureEventWith(
	posthog: PostHog | undefined,
	distinctId: string,
	event: string,
	properties?: Record<string, unknown>,
): void {
	posthog?.capture({ distinctId, event, properties: { ...properties, $process_person_profile: false } });
}

export function captureExceptionWith(
	posthog: PostHog | undefined,
	distinctId: string,
	error: unknown,
	properties?: Record<string, unknown>,
): void {
	if (posthog === undefined) return;
	posthog.captureException(error instanceof Error ? error : new Error(String(error)), distinctId, properties);
}
