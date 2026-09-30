import { motion } from 'framer-motion';
import { ChevronDown, Sparkles, Globe, Cpu, Infinity as InfinityIcon, Code2 } from 'lucide-react';
import AnimatedCounter from './AnimatedCounter';

const stats = [
  { icon: Sparkles, value: 50, suffix: '+', label: 'Future Projects' },
  { icon: Cpu, value: 10, suffix: '+', label: 'Technology Domains' },
  { icon: Globe, value: 1, suffix: '', label: 'Global Innovation Vision' },
  { icon: InfinityIcon, value: 100, suffix: '%', label: 'Unlimited Possibilities' },
];

export default function HeroSection() {
  return (
    <section
      id="home"
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
    >
      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[150px]" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-sm text-text-secondary">Teen-Built Technology Company</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold font-display tracking-tight leading-[1.1] mb-6"
        >
          We Build{' '}
          <span className="gradient-text">Digital Experiences</span>
          <br />
          That Move Businesses Forward
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="max-w-3xl mx-auto text-lg md:text-xl text-text-secondary leading-relaxed mb-10"
        >
          SHYGON Technologies is a teen-built technology company creating modern websites,
          web applications, AI solutions, and custom digital products for businesses. We turn ideas
          into fast, polished, real-world digital experiences.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
        >
          <a
            href="#services"
            className="group px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-medium text-white hover:from-cyan-400 hover:to-blue-500 transition-all duration-300 shadow-xl shadow-cyan-500/20 flex items-center gap-2"
          >
            Build Your Website
            <Code2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </a>
          <a
            href="#contact"
            className="px-8 py-4 rounded-2xl font-medium text-gray-900 bg-white border border-gray-300 hover:border-cyan-500 hover:text-cyan-600 transition-all duration-300 shadow-sm"
          >
            Start a Project
          </a>
          <a
            href="#about"
            className="px-8 py-4 rounded-2xl font-medium text-gray-900 bg-white border border-gray-300 hover:border-cyan-500 hover:text-cyan-600 transition-all duration-300 shadow-sm"
          >
            Meet the Team
          </a>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6"
        >
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1 + i * 0.1 }}
              className="glass rounded-2xl p-6 hover:bg-white/5 transition-colors duration-300 group"
            >
              <stat.icon className="w-6 h-6 text-cyan-400 mb-3 mx-auto group-hover:scale-110 transition-transform" />
              <div className="text-3xl md:text-4xl font-bold font-display gradient-text-cyan mb-1">
                <AnimatedCounter end={stat.value} suffix={stat.suffix} />
              </div>
              <div className="text-sm text-text-muted">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <ChevronDown className="w-6 h-6 text-text-muted" />
        </motion.div>
      </motion.div>
    </section>
  );
}
