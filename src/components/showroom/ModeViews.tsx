import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import type { PublicProfile } from '../../lib/database.types';
import { MODES, type ModeId } from './modes';
import { directionsHref, hrefOf, linkList, whatsappNumber } from './profileParts';

/**
 * The focused view a showroom card opens. One frame for all of them: a way
 * back to the showroom, the mode's name, and its content. The heading takes
 * focus on arrival so a screen reader announces where the visitor is.
 */
export function ModeFrame({ mode, onBack, children }: { mode: ModeId; onBack: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="sr sr-view" data-mode={mode}>
      <div className="sr-view-bar">
        <button type="button" className="sr-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Showroom
        </button>
      </div>
      <main className="sr-view-body">
        <h1 className="sr-view-title" ref={heading} tabIndex={-1}>
          {MODES[mode].name}
        </h1>
        {children}
      </main>
    </div>
  );
}

type Track = (key: string) => void;

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="sr-row">
      <span className="sr-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sr-row-text">
        <small>{label}</small>
        {children}
      </span>
    </div>
  );
}

export function BusinessView({ data, onLinkClick }: { data: PublicProfile; onLinkClick?: Track }) {
  const directions = directionsHref(data.location);
  const website = hrefOf(data.website);
  return (
    <>
      <p className="sr-view-lead">{data.displayName}</p>
      <div className="sr-rows">
        {data.designation && (
          <Row icon={<Briefcase size={17} />} label="Role">
            {data.designation}
          </Row>
        )}
        {data.company && (
          <Row icon={<Briefcase size={17} />} label="Company">
            {data.company}
          </Row>
        )}
        {data.location && (
          <Row icon={<MapPin size={17} />} label="Based in">
            {data.location}
          </Row>
        )}
      </div>
      <div className="sr-actions">
        {directions && (
          <a className="sr-action" href={directions} target="_blank" rel="noreferrer" onClick={() => onLinkClick?.('location')}>
            <MapPin size={17} aria-hidden="true" /> Directions <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        {website && (
          <a className="sr-action" href={website} target="_blank" rel="noreferrer" onClick={() => onLinkClick?.('website')}>
            <Globe size={17} aria-hidden="true" /> Website <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        {data.email && (
          <a className="sr-action" href={`mailto:${data.email}`} onClick={() => onLinkClick?.('email')}>
            <Mail size={17} aria-hidden="true" /> Email
          </a>
        )}
      </div>
    </>
  );
}

export function ContactView({ data, onLinkClick, onShare }: { data: PublicProfile; onLinkClick?: Track; onShare?: () => void }) {
  const whatsapp = whatsappNumber(data);
  return (
    <>
      <p className="sr-view-lead">Reach {data.displayName || 'the owner'} directly. Only the details they chose to publish are here.</p>
      <div className="sr-actions sr-actions-big">
        {data.phone && (
          <a className="sr-action sr-action-primary" href={`tel:${data.phone}`} onClick={() => onLinkClick?.('phone')}>
            <Phone size={18} aria-hidden="true" /> Call
          </a>
        )}
        {whatsapp && (
          <a
            className="sr-action sr-action-whatsapp"
            href={`https://wa.me/${whatsapp}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => onLinkClick?.('whatsapp')}
          >
            <MessageCircle size={18} aria-hidden="true" /> WhatsApp
          </a>
        )}
        {data.email && (
          <a className="sr-action" href={`mailto:${data.email}`} onClick={() => onLinkClick?.('email')}>
            <Mail size={18} aria-hidden="true" /> Email
          </a>
        )}
        {onShare && (
          <button type="button" className="sr-action" onClick={onShare}>
            <Share2 size={18} aria-hidden="true" /> Share this profile
          </button>
        )}
      </div>
    </>
  );
}

export function LinksView({ data, onLinkClick, demo = false }: { data: PublicProfile; onLinkClick?: Track; demo?: boolean }) {
  return (
    <>
      <p className="sr-view-lead">Where to find {data.displayName || 'the owner'} online.</p>
      <ul className="sr-link-list">
        {linkList(data).map((link) => (
          <li key={link.key}>
            {demo ? (
              // Sample links lead nowhere, so they are not links.
              <span className="sr-action sr-action-static">
                <Link2 size={17} aria-hidden="true" /> {link.label} <small>sample</small>
              </span>
            ) : (
              <a className="sr-action" href={link.href} target="_blank" rel="noreferrer" onClick={() => onLinkClick?.(link.key)}>
                <Link2 size={17} aria-hidden="true" /> <span>{link.label}</span> <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Owner access (FE-D3, the safest reading of "Owner Tap"): the card is also
 * the owner's way in, but only through the ordinary sign-in. Nothing on this
 * page can change the card, and holding or tapping it proves nothing.
 */
export function OwnerView({ data }: { data: PublicProfile }) {
  const name = data.displayName?.trim() || 'the owner';
  return (
    <>
      <p className="sr-view-lead">
        This card belongs to {name}. Only they can change what it shows, from their own signed-in SHYGON account.
      </p>
      <ul className="sr-facts-list">
        <li>Tapping or scanning a card never signs anyone in.</li>
        <li>Nothing on this page can change the card or reveal anything it does not already show.</li>
        <li>If you are the owner, sign in to manage your profile, pause it, or see its analytics.</li>
      </ul>
      <div className="sr-actions">
        <Link className="sr-action sr-action-primary" to="/shygontap/auth" state={{ from: '/shygontap/experience' }}>
          <KeyRound size={17} aria-hidden="true" /> I’m the owner: sign in
        </Link>
      </div>
      <p className="sr-fine">
        Lost your card? Sign in and pause your profile: nobody sees it until you publish it again. Switching off a lost card
        itself arrives with the card release.
      </p>
    </>
  );
}

/**
 * The emergency walkthrough, for the demo showroom only (FE-D4). It shows how
 * an alert would be asked for and what the owner would see, and sends
 * nothing: no request leaves the page. It never says that anyone was
 * alerted, and it says plainly that SHYGON does not contact emergency services.
 */
export function EmergencyDemoView() {
  const [step, setStep] = useState<'intro' | 'compose' | 'done'>('intro');
  const [reason, setReason] = useState<string>('');
  const [understood, setUnderstood] = useState(false);
  const reasonId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step !== 'intro') stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    <>
      <p className="sr-demo-flag" role="note">
        <strong>Demo.</strong> Nothing here is sent to anyone.
      </p>

      <div className="sr-callout sr-callout-danger">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <strong>Is someone in danger right now? Call 112.</strong>
          <p>SHYGON never contacts the police, an ambulance or the fire service, and an AAROH card cannot.</p>
          <a className="sr-action sr-action-danger" href="tel:112">
            <Phone size={17} aria-hidden="true" /> Call 112
          </a>
        </div>
      </div>

      {step === 'intro' && (
        <>
          <p className="sr-view-lead">
            When it is ready, an owner will be able to add emergency contacts in their account and, if they choose, let a
            visitor alert those contacts from their card, without the visitor ever seeing a name or a number.
          </p>
          <ul className="sr-facts-list">
            <li>Off unless the owner switches it on.</li>
            <li>The visitor never sees the contacts.</li>
            <li>Each contact’s status is shown as the provider reports it. Delivered means a delivery receipt came back; nothing less.</li>
          </ul>
          <div className="sr-actions">
            <button type="button" className="sr-action sr-action-primary" onClick={() => setStep('compose')}>
              Walk through an alert
            </button>
          </div>
        </>
      )}

      {step === 'compose' && (
        <form
          className="sr-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason || !understood) return;
            setStep('done');
          }}
        >
          <h2 className="sr-step-title" ref={stepHeading} tabIndex={-1}>
            Step 1 of 2: what happened?
          </h2>
          <fieldset className="sr-choices">
            <legend id={reasonId}>Choose one</legend>
            {[
              ['found-person', 'I am with the owner and they need help'],
              ['found-card', 'I found this card'],
              ['other', 'Something else'],
            ].map(([value, label]) => (
              <label key={value} className="sr-choice">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value!)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className="sr-check">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>I understand a real alert would go to the owner’s emergency contacts, and that it does not call emergency services.</span>
          </label>
          <div className="sr-actions">
            <button type="submit" className="sr-action sr-action-primary" disabled={!reason || !understood}>
              Step 2 of 2: review (demo)
            </button>
            <button type="button" className="sr-action" onClick={() => setStep('intro')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div className="sr-form" aria-live="polite">
          <h2 className="sr-step-title" ref={stepHeading} tabIndex={-1}>
            Demo finished. No alert was sent.
          </h2>
          <p className="sr-view-lead">
            In a real alert, the send button works once, and the page then shows each contact’s status as SHYGON receives it:
          </p>
          <dl className="sr-legend">
            <div>
              <dt>Sending…</dt>
              <dd>SHYGON has the alert and is handing it to the text-message provider.</dd>
            </div>
            <div>
              <dt>Sent</dt>
              <dd>The provider accepted it. That is not the same as delivered.</dd>
            </div>
            <div>
              <dt>Delivered</dt>
              <dd>Only when the provider sends back a delivery receipt.</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>The provider could not take it, even after retrying.</dd>
            </div>
            <div>
              <dt>Not sent</dt>
              <dd>It never left SHYGON, for example while no provider is set up.</dd>
            </div>
            <div>
              <dt>Stopped</dt>
              <dd>The owner stopped it before it was sent.</dd>
            </div>
          </dl>
          <div className="sr-actions">
            <button
              type="button"
              className="sr-action"
              onClick={() => {
                setReason('');
                setUnderstood(false);
                setStep('intro');
              }}
            >
              Start again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
