import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

// External system: a wall-clock timer that asks the router to reload loader
// data. Owns setup and cleanup; `intervalMs` is its only reactive input.
export const useAutoRefresh = (intervalMs: number) => {
	const router = useRouter();
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") void router.invalidate();
		}, intervalMs);
		return () => clearInterval(timer);
	}, [router, intervalMs]);
};
