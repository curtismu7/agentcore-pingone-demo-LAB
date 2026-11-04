import { TAG_LABELS } from "../releaseText";

// How well we know a row. The five tags are the same everywhere on the release tabs; the label is the server's when it sent one.
export default function ClaimTag({ tag, tags }) {
  const label = (tags && tags[tag]) || TAG_LABELS[tag] || "untagged";
  return <span className="tag tag--claim" data-tag={tag}>{label}</span>;
}

export function TagLegend({ tags }) {
  return (
    <p className="muted" data-testid="tag-legend">
      Every row says how well we know it: {Object.keys(tags || TAG_LABELS).map((k) => <span key={k}><ClaimTag tag={k} tags={tags} />{" "}</span>)}
    </p>
  );
}

export function WhyItMatters({ why }) {
  return (
    <section className="panel" aria-labelledby="why-h" data-testid="why-matters">
      <h2 id="why-h">Why it matters (Ping claims)</h2>
      <p className="muted">Per Ping&apos;s deck, slide {why.slide} ({why.feature}). UNVERIFIED on our tenant.</p>
      <dl className="kv">
        <dt>Challenge</dt><dd>{why.challenge}</dd>
        <dt>Technical value</dt><dd>{why.technical}</dd>
        <dt>Business value</dt><dd>{why.business}</dd>
      </dl>
    </section>
  );
}
