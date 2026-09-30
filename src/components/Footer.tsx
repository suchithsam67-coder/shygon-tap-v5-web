import { Linkedin, Github, Twitter, Instagram, Youtube } from 'lucide-react';
import { CONTACT_EMAIL } from '../lib/site';

const links = [
  { label: 'Home', href: '#home' },
  { label: 'About', href: '#about' },
  { label: 'Technologies', href: '#technologies' },
  { label: 'Products', href: '#products' },
  { label: 'Projects', href: '#projects' },
  { label: 'Careers', href: '#careers' },
  { label: 'Contact', href: '#contact' },
];

const socials = [
  { icon: Linkedin, href: '', label: 'LinkedIn' },
  { icon: Github, href: '', label: 'GitHub' },
  { icon: Twitter, href: '', label: 'X' },
  { icon: Instagram, href: '', label: 'Instagram' },
  { icon: Youtube, href: '', label: 'YouTube' },
];

export default function Footer() {
  return (
    <footer className="relative pt-20 pb-10 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-12 mb-16">
          <div className="md:col-span-2">
            <a href="#home" className="flex items-center gap-3 mb-4">
              <img
                src="/logo.png"
                alt="SHYGON Technologies"
                className="w-10 h-10 rounded-xl object-cover"
              />
              <span className="text-xl font-bold font-display">
                SHYGON<span className="gradient-text"> Technologies</span>
              </span>
            </a>
            <p className="text-text-secondary max-w-md mb-6">
              Innovating Beyond Tomorrow. We develop breakthrough technologies in AI, Robotics,
              Healthcare, Education, and Sustainable Solutions.
            </p>
            <div className="flex gap-3">
              {socials.filter((social) => Boolean(social.href)).map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className="w-10 h-10 rounded-xl glass flex items-center justify-center hover:bg-white/10 transition-colors group"
                >
                  <social.icon className="w-4 h-4 text-text-muted group-hover:text-cyan-400 transition-colors" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-text-secondary hover:text-cyan-400 transition-colors text-sm"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>{CONTACT_EMAIL}</li>
              <li>+91 9740806633</li>
              <li>India</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-text-muted">
            &copy; {new Date().getFullYear()} SHYGON Technologies Pvt. Ltd. All rights reserved.
          </p>
          <p className="text-sm text-text-muted italic">
            "Innovating Beyond Tomorrow."
          </p>
        </div>
      </div>
    </footer>
  );
}
