const STEPS = [
  { key: 'scope', label: 'Finding code connected to your feature' },
  { key: 'plan', label: 'Planning epics and user stories' },
  { key: 'write', label: 'Writing detailed Jira tickets' },
  { key: 'finalize', label: 'Finalizing ticket set' },
];

export default function GenerationLoader({ phase = 'scope', message }) {
  const phaseIndex = STEPS.findIndex((s) => s.key === phase);
  const activeIndex = phaseIndex >= 0 ? phaseIndex : 0;

  return (
    <div className="generation-loader" role="status" aria-live="polite">
      <div className="generation-loader-spinner" />
      <h3>Building your Jira tickets</h3>
      <p className="generation-loader-message">
        {message || 'Sarah ended the call and is putting your tickets together now. This usually takes 2–3 minutes.'}
      </p>
      <ol className="generation-steps">
        {STEPS.map((step, i) => (
          <li
            key={step.key}
            className={
              i < activeIndex ? 'done' : i === activeIndex ? 'active' : ''
            }
          >
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
