import { motion } from 'framer-motion';
import { Lightbulb, Shield, Leaf, Award, Heart, Globe } from 'lucide-react';
import SectionReveal from './SectionReveal';

const values = [
  { icon: Lightbulb, label: 'Innovation', color: 'from-cyan-400 to-blue-500' },
  { icon: Shield, label: 'Integrity', color: 'from-blue-500 to-purple-500' },
  { icon: Leaf, label: 'Sustainability', color: 'from-green-400 to-emerald-500' },
  { icon: Award, label: 'Excellence', color: 'from-yellow-400 to-orange-500' },
  { icon: Heart, label: 'Human-Centered Design', color: 'from-pink-400 to-rose-500' },
  { icon: Globe, label: 'Global Impact', color: 'from-purple-400 to-indigo-500' },
];

export default function AboutSection() {
  return (
    <section id="about" className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Teen-Built Company
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              About <span className="gradient-text">SHYGON</span> Technologies
            </h2>
          </div>
        </SectionReveal>

        <div className="grid lg:grid-cols-2 gap-12 items-center mb-20">
          <SectionReveal direction="left">
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 to-purple-600/20 rounded-3xl blur-2xl" />
              <div className="relative glass rounded-3xl p-8 md:p-10">
                <p className="text-lg md:text-xl text-text-secondary leading-relaxed mb-6">
                  SHYGON Technologies is a teen-built technology company focused on turning
                  ambitious ideas into practical digital products, from high-quality websites and web apps
                  to AI-powered solutions.
                </p>
                <p className="text-lg md:text-xl text-text-secondary leading-relaxed">
                  We started young, but we build seriously — combining modern design, development,
                  and emerging technology to help businesses establish a stronger digital presence.
                </p>
              </div>
            </div>
          </SectionReveal>

          <SectionReveal direction="right">
            <div className="grid grid-cols-2 gap-4">
              {values.map((value, i) => (
                <motion.div
                  key={value.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  whileHover={{ scale: 1.05 }}
                  className="glass rounded-2xl p-5 hover:bg-white/5 transition-all duration-300 group cursor-default"
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${value.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                    <value.icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-semibold text-sm">{value.label}</h3>
                </motion.div>
              ))}
            </div>
          </SectionReveal>
        </div>
{/* Leadership Team */}
<div className="mt-28">
  <SectionReveal>
    <div className="text-center mb-14">
      <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
        Leadership Team
      </span>

      <h2 className="text-4xl md:text-5xl font-bold font-display">
        Meet Our <span className="gradient-text">Leadership</span>
      </h2>
    </div>
  </SectionReveal>

  <div className="grid md:grid-cols-3 gap-8">
    {[
      {
        name: "Himavanth.V",
        role: "Chief Operating Officer (COO)",
      },
      {
        name: "Suchith",
        role: "Chief Executive Officer (CEO)",
      },
      {
        name: "Abhay",
        role: "Chief Financial Officer (CFO)",
      },
      {
        name: "gynandeep",
        role: "Graphic designer",
      },
    ].map((member, index) => (
      <motion.div
        key={member.name}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: index * 0.2 }}
        whileHover={{ y: -8 }}
        className="glass rounded-3xl p-8 text-center hover:bg-white/5 transition-all duration-300"
      >
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 mx-auto mb-6 flex items-center justify-center text-3xl font-bold text-black">
          {member.name.charAt(0)}
        </div>

        <h3 className="text-2xl font-bold mb-2">
          {member.name}
        </h3>

        <p className="text-cyan-400">
          {member.role}
        </p>
      </motion.div>
    ))}
  </div>
</div>
      </div>
    </section>
  );
}
