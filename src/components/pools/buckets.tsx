export interface Bucket {
	readonly time: string;
	readonly success: number;
	readonly failed: number;
}

// Twenty ten-minute buckets, failed stacked on success, scaled to the busiest bucket.
export function Buckets({ buckets }: { buckets: ReadonlyArray<Bucket> }) {
	const peak = Math.max(1, ...buckets.map((bucket) => bucket.success + bucket.failed));
	const total = buckets.reduce((sum, bucket) => sum + bucket.success + bucket.failed, 0);
	return (
		<div className="buckets-block">
			<span className="u-label">requests · 20 × 10m</span>
			<div className="buckets" role="img" aria-label={`${total} requests in the last 200 minutes`}>
				{buckets.map((bucket) => {
					const failed = `${(bucket.failed / peak) * 100}%`;
					const ok = `${(bucket.success / peak) * 100}%`;
					return (
						<span
							key={bucket.time}
							className="bucket"
							title={`${bucket.time} · ${bucket.success} ok · ${bucket.failed} failed`}
						>
							<span className="bucket-failed" style={{ height: failed }} />
							<span className="bucket-ok" style={{ height: ok }} />
						</span>
					);
				})}
			</div>
			<div className="u-axis">
				<span>−200m</span>
				<span>now</span>
			</div>
		</div>
	);
}
