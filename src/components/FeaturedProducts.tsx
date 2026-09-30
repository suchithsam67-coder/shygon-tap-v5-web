import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Sparkles,
  CreditCard,
  Building2,
  UtensilsCrossed,
  Hotel,
  Star,
  BadgeCheck,
} from "lucide-react";

import SectionReveal from "./SectionReveal";

const products = [
  {
    icon: CreditCard,
    title: "Business Cards",
  },
  {
    icon: UtensilsCrossed,
    title: "Restaurants",
  },
  {
    icon: Hotel,
    title: "Hotels",
  },
  {
    icon: Star,
    title: "Google Reviews",
  },
  {
    icon: BadgeCheck,
    title: "Employee IDs",
  },
  {
    icon: Building2,
    title: "Events",
  },
];

/**
 * Positions for the decorative particles.
 *
 * Deterministic on purpose: these were drawn with Math.random() during render,
 * so every re-render teleported all 18 of them. A hash of the index gives the
 * same irregular scatter on every render and every reload.
 */
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const hash = (n: number) => ((Math.sin(n) * 43758.5453) % 1 + 1) % 1;
  return { left: `${hash(i + 1) * 100}%`, top: `${hash(i + 99) * 100}%` };
});

export default function FeaturedProducts() {
  return (
    <section
      id="products"
      className="relative min-h-[90vh] overflow-hidden py-24"
    >
      {/* Background */}

      <div className="absolute inset-0">

        <div className="absolute -left-32 top-20 w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[180px]" />

        <div className="absolute right-0 bottom-0 w-[450px] h-[450px] rounded-full bg-blue-500/10 blur-[180px]" />

      </div>

      <div className="relative max-w-7xl mx-auto px-6">

        <SectionReveal>

          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* LEFT */}

            <div>

              <motion.div

                initial={{ opacity: 0, y: 20 }}

                whileInView={{ opacity: 1, y: 0 }}

                viewport={{ once: true }}

                transition={{ duration: 0.6 }}

                className="inline-flex items-center gap-2 rounded-full glass px-5 py-2"

              >

                <Sparkles className="w-4 h-4 text-cyan-400" />

                <span className="text-cyan-300 text-sm">

                  Flagship Product

                </span>

              </motion.div>

              <h1 className="mt-8 text-6xl md:text-7xl font-black leading-none font-display">

                SHYGON

                <span className="gradient-text">

                  {" "}TAP

                </span>

              </h1>

              <h2 className="mt-6 text-3xl font-semibold">

                One Tap.

                <br />

                Infinite Possibilities.

              </h2>

              <p className="mt-8 text-lg leading-8 text-text-secondary max-w-xl">

                Transform the way businesses connect with customers
                using beautifully designed NFC products that instantly
                share contacts, menus, reviews, portfolios and much more.

              </p>

              {/* Feature Chips */}

              <div className="mt-12 flex flex-wrap gap-4">

                {products.map((item) => {

                  const Icon = item.icon;

                  return (

                    <motion.div

                      key={item.title}

                      whileHover={{
                        y: -6,
                        scale: 1.05,
                      }}

                      className="glass px-5 py-4 rounded-2xl flex items-center gap-3 cursor-pointer"

                    >

                      <Icon className="w-5 h-5 text-cyan-400" />

                      <span>{item.title}</span>

                    </motion.div>

                  );

                })}

              </div>

<motion.div
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  className="mt-14 inline-block"
>
<Link
  to="/shygontap"
  className="px-8 py-5 rounded-2xl bg-cyan-400 text-black font-bold flex items-center gap-3"
>
  View Collection
  <ArrowRight size={18} />
</Link>
</motion.div>

            </div>

            {/* RIGHT SIDE STARTS HERE */}

<div className="relative flex justify-center items-center h-[700px]">

  {/* Main Blue Glow */}

  <motion.div
    animate={{
      scale: [1, 1.08, 1],
      opacity: [0.45, 0.8, 0.45],
    }}
    transition={{
      duration: 5,
      repeat: Infinity,
      ease: "easeInOut",
    }}
    className="absolute w-[520px] h-[520px] rounded-full bg-cyan-500/20 blur-[130px]"
  />

  {/* Outer Ring */}

  <motion.div
    animate={{
      rotate: 360,
    }}
    transition={{
      duration: 30,
      repeat: Infinity,
      ease: "linear",
    }}
    className="absolute w-[520px] h-[520px] rounded-full border border-cyan-400/10"
  />

  {/* Middle Ring */}

  <motion.div
    animate={{
      rotate: -360,
    }}
    transition={{
      duration: 20,
      repeat: Infinity,
      ease: "linear",
    }}
    className="absolute w-[390px] h-[390px] rounded-full border border-cyan-400/20"
  />

  {/* Floating Card */}

  <motion.div

    animate={{
      y: [0, -18, 0],
      rotateX: [0, 6, 0],
      rotateY: [-8, 8, -8],
    }}

    transition={{
      duration: 7,
      repeat: Infinity,
      ease: "easeInOut",
    }}

    style={{
      transformStyle: "preserve-3d",
    }}

    className="relative z-20"

  >

    <div className="w-[390px] h-[240px] rounded-[28px] overflow-hidden bg-gradient-to-br from-[#08111f] via-[#10263c] to-[#07131f] border border-cyan-400/30 shadow-[0_0_70px_rgba(34,211,238,0.25)]">

      {/* Shine */}

      <motion.div

        animate={{
          x: [-250, 450],
        }}

        transition={{
          duration: 3,
          repeat: Infinity,
          repeatDelay: 2,
          ease: "easeInOut",
        }}

        className="absolute top-0 left-0 w-24 h-full bg-white/10 blur-xl rotate-12"

      />

      <div className="relative h-full p-8 flex flex-col justify-between">

        <div className="flex justify-between">

          <div>

            <p className="text-xs uppercase tracking-[6px] text-cyan-300">

              SHYGON

            </p>

            <h2 className="mt-2 text-3xl font-black">

              TAP

            </h2>

          </div>

          <CreditCard
            size={34}
            className="text-cyan-400"
          />

        </div>

        <div>

          <p className="text-xl font-semibold">

            Himavanth

          </p>

          <p className="text-cyan-300 mt-1">

            Managing Director

          </p>

        </div>

      </div>

    </div>

  </motion.div>

  {/* NFC Waves */}

  {[0, 1, 2].map((i) => (

    <motion.div

      key={i}

      animate={{
        scale: [0.7, 1.7],
        opacity: [0.5, 0],
      }}

      transition={{
        duration: 2.8,
        repeat: Infinity,
        delay: i * 0.7,
        ease: "easeOut",
      }}

      className="absolute w-48 h-48 rounded-full border border-cyan-400/30"

    />

  ))}

</div>
          </div>

        </SectionReveal>

      </div>

      {/* Decorative Background */}

      <div className="absolute inset-0 pointer-events-none overflow-hidden">

        {PARTICLES.map((particle, i) => (

          <motion.div
            key={i}
            animate={{
              y: [0, -80, 0],
              opacity: [0.15, 0.5, 0.15],
            }}
            transition={{
              duration: 6 + i,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={particle}
            className="absolute w-1 h-1 rounded-full bg-cyan-400"
          />

        ))}

      </div>

      {/* Bottom Divider */}

      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

    </section>
  );
}