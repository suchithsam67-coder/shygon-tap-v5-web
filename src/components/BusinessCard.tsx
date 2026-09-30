import { Mail, Phone, MapPin } from "lucide-react";
import { motion } from "framer-motion";

export default function BusinessCard() {
  return (
    <section className="py-24 bg-black relative overflow-hidden">

      <div className="max-w-7xl mx-auto px-6">

        <motion.div
          initial={{opacity:0,y:50}}
          whileInView={{opacity:1,y:0}}
          transition={{duration:.8}}
          className="grid lg:grid-cols-2 rounded-3xl overflow-hidden border border-yellow-500/30 bg-[#0b0b0b]"
        >

          {/* LEFT SIDE */}

          <div className="p-16 flex flex-col items-center justify-center relative">

            <div className="absolute w-96 h-96 bg-yellow-500/5 blur-[150px]" />

            {/* LOGO */}

            <img
              src="/logo.png"
              className="w-52 relative z-10"
            />

            <h1 className="text-6xl font-bold text-yellow-400 mt-8 tracking-widest">

              SHYGON

            </h1>

            <p className="text-gray-300 tracking-[8px] mt-4">

              TECHNOLOGIES

            </p>

            <div className="w-48 h-[2px] bg-yellow-500 mt-8"/>

            <p className="text-yellow-400 tracking-[6px] mt-8">

              BUILT AHEAD.

            </p>

          </div>

          {/* RIGHT SIDE */}

          <div className="p-16 border-l border-yellow-500/20">

            <h2 className="text-5xl font-bold text-yellow-400">

              HIMAVANTH.V

            </h2>

            <p className="text-gray-400 tracking-[5px] mt-4">

              MANAGING DIRECTOR

            </p>

            <div className="w-28 h-[2px] bg-yellow-500 mt-8"/>

            <div className="space-y-8 mt-12">

              <div className="flex items-center gap-5">

                <Mail className="text-yellow-400"/>

                <span className="text-xl">

                  himavanth2222@gmail.com

                </span>

              </div>

              <div className="flex items-center gap-5">

                <Phone className="text-yellow-400"/>

                <span className="text-xl">

                  +91 9740806633

                </span>

              </div>

              <div className="flex items-center gap-5">

                <MapPin className="text-yellow-400"/>

                <span className="text-xl">

                  Bangalore, India

                </span>

              </div>

            </div>

            <button className="mt-14 bg-yellow-500 text-black px-8 py-4 rounded-xl font-bold hover:scale-105 transition">

              Contact Now

            </button>

          </div>

        </motion.div>

      </div>

    </section>
  );
}