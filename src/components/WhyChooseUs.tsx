import { motion } from 'framer-motion';
import { Rocket, Globe, FlaskConical, Lightbulb, Layers, Users, Leaf } from 'lucide-react';
import SectionReveal from './SectionReveal';
import AnimatedCounter from './AnimatedCounter';

const benefits = [
  { icon: Rocket, label: 'Future-Ready Technology', value: 98, suffix: '%' },
  { icon: Globe, label: 'Global Vision', value: 50, suffix: '+' },
  { icon: FlaskConical, label: 'Research-Driven Development', value: 200, suffix: '+' },
  { icon: Lightbulb, label: 'Innovative Solutions', value: 100, suffix: '+' },
  { icon: Layers, label: 'Scalable Platforms', value: 99, suffix: '%' },
  { icon: Users, label: 'User-Centric Design', value: 95, suffix: '%' },
  { icon: Leaf, label: 'Sustainable Innovation', value: 100, suffix: '%' },
];

export default function WhyChooseUs() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Why Choose Us
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Why <span className="gradient-text">SHYGON</span>
            </h2>
            <p className="max-w-2xl mx-auto text-text-secondary text-lg">
              We combine cutting-edge research with practical innovation
            </p>
          </div>
        </SectionReveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {benefits.map((benefit, i) => (
            <SectionReveal key={benefit.label} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -6, scale: 1.02 }}
                className="group glass rounded-2xl p-6 hover:bg-white/5 transition-all duration-300 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-purple-600/20 flex items-center justify-center mx-auto mb-4 group-hover:from-cyan-400/30 group-hover:to-purple-600/30 transition-all duration-300">
                  <benefit.icon className="w-7 h-7 text-cyan-400 group-hover:scale-110 transition-transform" />
                </div>
                <div className="text-3xl font-bold font-display gradient-text-cyan mb-2">
                  <AnimatedCounter end={benefit.value} suffix={benefit.suffix} />
                </div>
                <div className="text-sm text-text-secondary">{benefit.label}</div>
              </motion.div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
