import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

// External system: a wall-clock timer that asks the router to reload loader
// data, and a visibility listener so a tab coming back does not wait for the
// next tick. Owns setup and cleanup; `intervalMs` is its only reactive input.
export const useAutoRefresh = (intervalMs: number) => {
	const router = useRouter();
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") void router.invalidate();
		}, intervalMs);
		const onVisible = () => {
			if (document.visibilityState === "visible") void router.invalidate();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [router, intervalMs]);
};
