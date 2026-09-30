import { motion } from 'framer-motion';
import { Flag, Brain, Bot, Globe, Network, Crown } from 'lucide-react';
import SectionReveal from './SectionReveal';

const events = [
  { year: '2026', title: 'SHYGON Technologies Founded', icon: Flag, color: 'from-cyan-400 to-blue-500' },
  { year: '2027', title: 'AI Product Expansion', icon: Brain, color: 'from-blue-400 to-purple-500' },
  { year: '2028', title: 'Robotics Division Launch', icon: Bot, color: 'from-purple-400 to-pink-500' },
  { year: '2029', title: 'International Collaborations', icon: Globe, color: 'from-pink-400 to-red-500' },
  { year: '2030', title: 'Global Innovation Network', icon: Network, color: 'from-red-400 to-orange-500' },
  { year: '2035', title: 'Worldwide Technology Leadership Vision', icon: Crown, color: 'from-yellow-400 to-amber-500' },
];

export default function Timeline() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="max-w-5xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-20">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Our Journey
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Company <span className="gradient-text">Timeline</span>
            </h2>
          </div>
        </SectionReveal>

        <div className="relative">
          {/* Center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-500/50 via-purple-500/50 to-transparent hidden md:block" />

          <div className="space-y-12 md:space-y-0">
            {events.map((event, i) => (
              <SectionReveal key={event.year} delay={i * 0.1}>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className={`relative flex items-center gap-8 md:gap-0 ${
                    i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'
                  }`}
                >
                  {/* Content */}
                  <div className={`flex-1 ${i % 2 === 0 ? 'md:text-right md:pr-12' : 'md:text-left md:pl-12'}`}>
                    <div className="glass rounded-2xl p-6 hover:bg-white/5 transition-all duration-300 inline-block">
                      <span className={`text-3xl font-bold font-display bg-gradient-to-r ${event.color} bg-clip-text text-transparent`}>
                        {event.year}
                      </span>
                      <h3 className="text-lg font-semibold mt-2">{event.title}</h3>
                    </div>
                  </div>

                  {/* Center dot */}
                  <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 z-10">
                    <motion.div
                      whileHover={{ scale: 1.3 }}
                      className={`w-12 h-12 rounded-full bg-gradient-to-br ${event.color} flex items-center justify-center shadow-lg`}
                    >
                      <event.icon className="w-5 h-5 text-white" />
                    </motion.div>
                  </div>

                  {/* Spacer for other side */}
                  <div className="flex-1 hidden md:block" />
                </motion.div>
              </SectionReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
