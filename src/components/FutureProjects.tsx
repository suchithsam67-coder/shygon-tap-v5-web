import { motion } from 'framer-motion';
import { Headphones, Smile, Home, Bot, Network } from 'lucide-react';
import SectionReveal from './SectionReveal';

const projects = [
  {
    title: 'Universal Language Earbuds',
    icon: Headphones,
    description: 'Real-time multilingual communication system breaking down language barriers worldwide.',
    status: 'In Development',
    color: 'from-cyan-400 to-blue-500',
  },
  {
    title: 'Emotion-Aware Learning System',
    icon: Smile,
    description: 'AI detects student engagement and adapts teaching methods in real-time for optimal outcomes.',
    status: 'Research Phase',
    color: 'from-yellow-400 to-orange-500',
  },
  {
    title: 'Smart Village Platform',
    icon: Home,
    description: 'Comprehensive technology ecosystem for rural development and digital inclusion.',
    status: 'Pilot Program',
    color: 'from-green-400 to-emerald-500',
  },
  {
    title: 'Autonomous Assistance Robots',
    icon: Bot,
    description: 'Robots designed to support daily activities for elderly and people with disabilities.',
    status: 'Prototype Testing',
    color: 'from-purple-400 to-pink-500',
  },
  {
    title: 'Future Healthcare Network',
    icon: Network,
    description: 'Connected healthcare infrastructure powered by AI for predictive and preventive care.',
    status: 'Architecture Design',
    color: 'from-red-400 to-rose-500',
  },
];

export default function FutureProjects() {
  return (
    <section id="projects" className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/5 rounded-full blur-[150px]" />

      <div className="max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center mb-16">
            <span className="inline-block px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-4">
              Future Projects
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Projects <span className="gradient-text">In Progress</span>
            </h2>
            <p className="max-w-2xl mx-auto text-text-secondary text-lg">
              Pioneering the next wave of technological breakthroughs
            </p>
          </div>
        </SectionReveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, i) => (
            <SectionReveal key={project.title} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -8 }}
                className="group relative glass rounded-3xl p-8 hover:bg-white/5 transition-all duration-500 overflow-hidden h-full"
              >
                <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${project.color}`} />

                <div className="flex items-center justify-between mb-6">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${project.color} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                    <project.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${project.color} bg-clip-text text-transparent border border-white/10`}>
                    {project.status}
                  </span>
                </div>

                <h3 className="text-xl font-bold font-display mb-3">{project.title}</h3>
                <p className="text-text-secondary leading-relaxed text-sm">{project.description}</p>

                <div className="mt-6 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${30 + i * 12}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: 0.3 }}
                    className={`h-full bg-gradient-to-r ${project.color} rounded-full`}
                  />
                </div>
              </motion.div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
