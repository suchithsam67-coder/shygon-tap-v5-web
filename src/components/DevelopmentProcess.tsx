import { motion } from "framer-motion";
import {
  Search,
  PenTool,
  Code2,
  Bug,
  Rocket,
  Headphones,
} from "lucide-react";

const steps = [
  {
    icon: Search,
    title: "Requirement Analysis",
    desc: "We understand your business goals and project requirements.",
  },
  {
    icon: PenTool,
    title: "UI / UX Design",
    desc: "Designing modern, attractive and user-friendly interfaces.",
  },
  {
    icon: Code2,
    title: "Development",
    desc: "Building fast, scalable and secure software solutions.",
  },
  {
    icon: Bug,
    title: "Testing",
    desc: "Ensuring quality, security and performance before launch.",
  },
  {
    icon: Rocket,
    title: "Deployment",
    desc: "Deploying your project with optimized performance.",
  },
  {
    icon: Headphones,
    title: "Support",
    desc: "Continuous maintenance and dedicated technical support.",
  },
];

export default function DevelopmentProcess() {
  return (
    <section className="py-24 bg-[#050505] text-white">
      <div className="max-w-7xl mx-auto px-6">

        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold">
            Our <span className="text-yellow-400">Development Process</span>
          </h2>

          <p className="text-gray-400 mt-5">
            A streamlined process to deliver reliable digital solutions.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">

          {steps.map((step, index) => {
            const Icon = step.icon;

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -8 }}
                className="bg-[#111111] border border-yellow-500/20 rounded-3xl p-8"
              >
                <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-6">
                  <Icon className="text-yellow-400" size={30} />
                </div>

                <h3 className="text-2xl font-bold mb-3">
                  {step.title}
                </h3>

                <p className="text-gray-400">
                  {step.desc}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}