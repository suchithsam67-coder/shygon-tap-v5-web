import { motion } from "framer-motion";
import {
  Globe2,
  Smartphone,
  ShoppingCart,
  Bot,
  Palette,
  Wrench,
  ArrowUpRight,
} from "lucide-react";
import SectionReveal from "./SectionReveal";

const services = [
  {
    icon: Globe2,
    title: "Business Websites",
    description:
      "Modern, responsive websites that make your business look credible, premium, and ready to grow.",
  },
  {
    icon: ShoppingCart,
    title: "E-Commerce Websites",
    description:
      "Online stores with product showcases, smooth user journeys, and the features your business actually needs.",
  },
  {
    icon: Smartphone,
    title: "Web & Mobile Apps",
    description:
      "Custom digital products built around your workflow, customers, and long-term goals.",
  },
  {
    icon: Bot,
    title: "AI-Powered Solutions",
    description:
      "Useful AI features and automation that turn repetitive work into smarter digital experiences.",
  },
  {
    icon: Palette,
    title: "UI / UX Design",
    description:
      "Clean interfaces and thoughtful user experiences designed to feel as good as they look.",
  },
  {
    icon: Wrench,
    title: "Custom Software",
    description:
      "From internal tools to complete platforms, we build software around the problem you're solving.",
  },
];

export default function WebServicesSection() {
  return (
    <section id="services" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-10 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-[140px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6">
        <SectionReveal>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-sm text-cyan-400 mb-5">
              <Globe2 className="w-4 h-4" />
              What We Build
            </span>

            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold font-display mb-6">
              Websites. Apps.{" "}
              <span className="gradient-text">Ideas Made Real.</span>
            </h2>

            <p className="text-lg md:text-xl text-text-secondary leading-relaxed">
              We're not just experimenting with technology. We build real digital
              solutions for businesses — starting with websites and web experiences
              that are designed to help them grow.
            </p>
          </div>
        </SectionReveal>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, index) => {
            const Icon = service.icon;

            return (
              <SectionReveal key={service.title} delay={index * 0.06}>
                <motion.div
                  whileHover={{ y: -8 }}
                  className="group relative glass rounded-3xl p-7 h-full overflow-hidden hover:bg-white/5 transition-all duration-300"
                >
                  <div className="absolute -right-10 -top-10 w-28 h-28 rounded-full bg-cyan-400/5 blur-2xl group-hover:bg-cyan-400/10 transition-colors" />

                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-blue-600/20 border border-cyan-400/10 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-cyan-400" />
                    </div>
                    <ArrowUpRight className="w-5 h-5 text-text-muted group-hover:text-cyan-400 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>

                  <h3 className="text-xl font-bold font-display mb-3">
                    {service.title}
                  </h3>

                  <p className="text-text-secondary leading-relaxed">
                    {service.description}
                  </p>
                </motion.div>
              </SectionReveal>
            );
          })}
        </div>

        <SectionReveal>
          <div className="mt-14 text-center">
            <p className="text-sm text-text-muted">
              Have an idea that doesn't fit a box?{" "}
              <a
                href="#contact"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Let's build it.
              </a>
            </p>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
