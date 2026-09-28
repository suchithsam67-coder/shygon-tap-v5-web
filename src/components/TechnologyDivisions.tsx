import { motion } from 'framer-motion';
import {
  Brain, Bot, HeartPulse, GraduationCap, Bus, Wifi, Rocket, Sun,
  Mic, BookOpen, Image, BarChart3, Factory, School, Stethoscope,
  MapPin, Home, Sprout, Factory as FactoryIcon, TreePine, Satellite,
  Radio, Battery, Wind, Leaf
} from 'lucide-react';
import SectionReveal from './SectionReveal';

const divisions = [
  {
    title: 'Artificial Intelligence',
    icon: Brain,
    color: 'from-cyan-400 to-blue-500',
    items: [
      { icon: Mic, label: 'Voice Assistants' },
      { icon: BookOpen, label: 'AI Tutors' },
      { icon: Image, label: 'Generative AI' },
      { icon: Brain, label: 'Computer Vision' },
      { icon: BarChart3, label: 'Predictive Analytics' },
    ],
  },
  {
    title: 'Robotics',
    icon: Bot,
    color: 'from-purple-400 to-pink-500',
    items: [
      { icon: Bot, label: 'Service Robots' },
      { icon: School, label: 'Educational Robots' },
      { icon: Factory, label: 'Industrial Automation' },
      { icon: FactoryIcon, label: 'Smart Manufacturing' },
    ],
  },
  {
    title: 'Healthcare Technology',
    icon: HeartPulse,
    color: 'from-red-400 to-rose-500',
    items: [
      { icon: Brain, label: 'AI Diagnostics' },
      { icon: HeartPulse, label: 'Smart Health Monitoring' },
      { icon: Stethoscope, label: 'Rural Healthcare Solutions' },
      { icon: BarChart3, label: 'Medical Analytics' },
    ],
  },
  {
    title: 'Education Technology',
    icon: GraduationCap,
    color: 'from-yellow-400 to-orange-500',
    items: [
      { icon: Bot, label: 'AI Classroom Assistant' },
      { icon: BookOpen, label: 'Offline Learning Systems' },
      { icon: GraduationCap, label: 'Personalized Learning Platforms' },
      { icon: School, label: 'Smart School Solutions' },
    ],
  },
  {
    title: 'Smart Transportation',
    icon: Bus,
    color: 'from-green-400 to-emerald-500',
    items: [
      { icon: MapPin, label: 'School Bus Tracking Systems' },
      { icon: Bus, label: 'Fleet Management' },
      { icon: HeartPulse, label: 'Vehicle Monitoring' },
      { icon: MapPin, label: 'Intelligent Navigation' },
    ],
  },
  {
    title: 'Internet of Things',
    icon: Wifi,
    color: 'from-blue-400 to-indigo-500',
    items: [
      { icon: Home, label: 'Smart Homes' },
      { icon: Sprout, label: 'Smart Agriculture' },
      { icon: Factory, label: 'Industrial IoT' },
      { icon: TreePine, label: 'Environmental Monitoring' },
    ],
  },
  {
    title: 'Space Technology',
    icon: Rocket,
    color: 'from-indigo-400 to-purple-500',
    items: [
      { icon: Satellite, label: 'Satellite Systems' },
      { icon: Rocket, label: 'Space Research Tools' },
      { icon: Radio, label: 'Advanced Communication Technologies' },
    ],
  },
  {
    title: 'Sustainable Energy',
    icon: Sun,
    color: 'from-emerald-400 to-teal-500',
    items: [
      { icon: Battery, label: 'Smart Energy Management' },
      { icon: Wind, label: 'Renewable Energy Solutions' },
      { icon: Leaf, label: 'Green Technology Systems' },
    ],
  },
];

export default function TechnologyDivisions() {
  return (
    <section id="technologies" className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute top-1/3 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-[100px]" />
      <div className="absolute bottom-1/3 left-0 w-80 h-80 bg-purple-600/5 rounded-full blur-[100px]" />

      <div className="max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Our Divisions
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Technology <span className="gradient-text">Divisions</span>
            </h2>
            <p className="max-w-2xl mx-auto text-text-secondary text-lg">
              Pioneering breakthrough solutions across multiple technology domains
            </p>
          </div>
        </SectionReveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {divisions.map((division, i) => (
            <SectionReveal key={division.title} delay={i * 0.05}>
              <motion.div
                whileHover={{ y: -8 }}
                className="group glass rounded-2xl p-6 hover:bg-white/5 transition-all duration-500 h-full"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${division.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                  <division.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold font-display mb-3">{division.title}</h3>
                <ul className="space-y-2">
                  {division.items.map((item) => (
                    <li key={item.label} className="flex items-center gap-2 text-sm text-text-muted group-hover:text-text-secondary transition-colors">
                      <item.icon className="w-3.5 h-3.5 text-cyan-400/60" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
