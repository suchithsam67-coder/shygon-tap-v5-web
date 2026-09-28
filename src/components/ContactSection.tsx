import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Calendar, Mail, MapPin, Phone } from 'lucide-react';
import SectionReveal from './SectionReveal';
import { CONTACT_EMAIL } from '../lib/site';

export default function ContactSection() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();

  const subject = encodeURIComponent(
    `Inquiry from ${formData.name}`
  );

  const body = encodeURIComponent(`
Name: ${formData.name}
Email: ${formData.email}
Phone: ${formData.phone}
Company: ${formData.company}

Message:
${formData.message}
`);

  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;

  setFormData({
    name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
  });
};

  return (
    <section id="contact" className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Get In Touch
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Contact <span className="gradient-text">Us</span>
            </h2>
            <p className="max-w-2xl mx-auto text-text-secondary text-lg">
              Ready to innovate? Let's build the future together
            </p>
          </div>
        </SectionReveal>

        <div className="grid lg:grid-cols-5 gap-12">
          <SectionReveal direction="left" className="lg:col-span-2">
            <div className="space-y-6">
              <div className="glass rounded-2xl p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-600/20 flex items-center justify-center mb-4">
                  <Mail className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="font-semibold mb-1">Email Us</h3>
                <a
  href={`mailto:${CONTACT_EMAIL}`}
  className="text-text-secondary text-sm hover:text-cyan-400 transition-colors"
>
  {CONTACT_EMAIL}
</a>
              </div>

              <div className="glass rounded-2xl p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-600/20 flex items-center justify-center mb-4">
                  <Phone className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="font-semibold mb-1">Call Us</h3>
<a
  href="tel:+919740806633"
  className="text-text-secondary text-sm hover:text-cyan-400 transition-colors"
>
  +91 9740806633
</a>
              </div>

              <div className="glass rounded-2xl p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400/20 to-purple-600/20 flex items-center justify-center mb-4">
                  <MapPin className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="font-semibold mb-1">Visit Us</h3>
                <p className="text-text-secondary text-sm">India</p>
              </div>
            </div>
          </SectionReveal>

          <SectionReveal direction="right" className="lg:col-span-3">
            <form onSubmit={handleSubmit} className="glass rounded-3xl p-8">
              <div className="grid sm:grid-cols-2 gap-5 mb-5">
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">Full Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-text-muted focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">Email</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-text-muted focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="john@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-text-muted focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">Company</label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-text-muted focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="Company Name"
                  />
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-text-secondary">Message</label>
                <textarea
                  required
                  rows={4}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-text-muted focus:outline-none focus:border-cyan-400/50 transition-colors resize-none"
                  placeholder="Tell us about your project..."
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="flex-1 px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-medium text-white hover:from-cyan-400 hover:to-blue-500 transition-all duration-300 shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Submit Inquiry
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() =>
  window.open(
    "https://wa.me/919740806633?text=Hi%20SHYGON%20Technologies,%20I%20would%20like%20to%20schedule%20a%20meeting.",
    "_blank"
  )
}
                  className="flex-1 px-6 py-4 glass rounded-xl font-medium text-white hover:bg-white/10 transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Calendar className="w-4 h-4" />
                  Schedule Meeting
                </motion.button>
              </div>
            </form>
          </SectionReveal>
        </div>
      </div>
    </section>
  );
}
