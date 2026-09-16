import { useSyncExternalStore } from "react";

// A one-second clock as an external store, so "observed 12 s ago" ticks
// without an effect. The server snapshot is fixed so hydration matches.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	timer ??= setInterval(() => listeners.forEach((fn) => fn()), 1000);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};
};

const getSnapshot = () => Math.floor(Date.now() / 1000) * 1000;

export const useNow = (serverNow: number) =>
	useSyncExternalStore(subscribe, getSnapshot, () => serverNow);
