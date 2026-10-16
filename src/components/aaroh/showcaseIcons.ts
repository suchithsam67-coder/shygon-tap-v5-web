import {
  BarChart3,
  CalendarDays,
  Cloud,
  CreditCard,
  Eye,
  HeartPulse,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Palette,
  Phone,
  QrCode,
  GraduationCap,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ShowcaseIcon } from '../../data/aarohProduct';

/** The showcase's icons (lucide-react), by the ids in AAROH_SHOWCASE. */
export const SHOWCASE_ICONS: Record<ShowcaseIcon, LucideIcon> = {
  profile: UserRound,
  contact: Phone,
  buttons: MessageCircle,
  look: Palette,
  share: QrCode,
  analytics: BarChart3,
  visibility: Eye,
  card: CreditCard,
  return: LifeBuoy,
  emergency: HeartPulse,
  student: GraduationCap,
  event: CalendarDays,
  place: MapPin,
  cloud: Cloud,
};
