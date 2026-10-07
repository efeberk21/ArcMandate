import { deriveNextStep, type AppState } from '../lib/next-step';

export function NextStepCard({ state, onAction }: { state: AppState; onAction: (id: string) => void }) {
  const step = deriveNextStep(state);

  return (
    <section className="next-step-card" role="region" aria-label="Next Step">
      <div className="next-step-layout">
        <div>
          <span className="eyebrow">Recommended next step</span>
          <h2>{step.title}</h2>
          <p>{step.body}</p>
        </div>
        {step.primaryAction && (
          <button
            disabled={step.blockedBy.length > 0}
            onClick={() => onAction(step.id)}
            className="primary"
          >
            {step.primaryAction}
          </button>
        )}
      </div>
      {step.blockedBy.length > 0 && (
        <ul className="muted">
          {step.blockedBy.map(reason => <li key={reason}>Blocked by: {reason}</li>)}
        </ul>
      )}
    </section>
  );
}
