import { useEffect, useRef, useState } from 'react';
import { BedDouble, Building2 } from 'lucide-react';

const SERVICES = ['Fresh towels', 'Housekeeping', 'Late check-out', 'A table at the restaurant'] as const;

/**
 * SHYGON Privé, as a demonstration only (master brief 2026-10-19 §11): a
 * sample hotel owned by SHYGON, a sample stay and sample services. A request
 * stays on this page. Nothing is connected to a hotel system; nothing is
 * booked; no door opens; and it never says a hotel received anything.
 *
 * Shown only in the demo showroom. Privé is not part of the launch: it is a
 * demo only (DEC-2026-038 Q6 → A, DEC-2026-040), and this wording is the
 * owner's, approved as drafted (Q-F, 2026-10-23).
 */
export function PriveDemoView() {
  const [chosen, setChosen] = useState<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (chosen) resultHeading.current?.focus({ preventScroll: true });
  }, [chosen]);

  return (
    <>
      <p className="sr-demo-flag" role="note">
        <strong>Demo.</strong> A sample hotel. Not connected to any real hotel, booking, room or door.
      </p>
      <div className="sr-rows">
        <div className="sr-row">
          <span className="sr-row-icon" aria-hidden="true">
            <Building2 size={17} />
          </span>
          <span className="sr-row-text">
            <small>Sample hotel</small>
            SHYGON Demo Residence
          </span>
        </div>
        <div className="sr-row">
          <span className="sr-row-icon" aria-hidden="true">
            <BedDouble size={17} />
          </span>
          <span className="sr-row-text">
            <small>Sample stay</small>
            Room 000 · Guest
          </span>
        </div>
      </div>

      {!chosen ? (
        <>
          <p className="sr-view-lead">
            In a hotel that uses Privé, a guest’s card could open requests like these. Choose one to see what the demo does.
          </p>
          <div className="sr-actions">
            {SERVICES.map((service) => (
              <button key={service} type="button" className="sr-action" onClick={() => setChosen(service)}>
                {service}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="sr-form" aria-live="polite">
          <h2 className="sr-step-title" ref={resultHeading} tabIndex={-1}>
            Not sent: this is a demo
          </h2>
          <p className="sr-view-lead">
            “{chosen}” stayed on this page. No hotel received it. A real hotel would first connect its own systems to SHYGON,
            and that is not part of this release.
          </p>
          <div className="sr-actions">
            <button type="button" className="sr-action" onClick={() => setChosen(null)}>
              Back to the sample services
            </button>
          </div>
        </div>
      )}
    </>
  );
}
