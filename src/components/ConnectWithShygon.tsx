import { motion } from "framer-motion";
import { Globe, Instagram, Phone } from "lucide-react";
import { SITE_URL } from "../lib/site";

export default function ConnectWithShygon() {
  return (
    <section
      id="connect"
      className="py-24 bg-[#050505] text-white"
    >
      <div className="max-w-7xl mx-auto px-6">

        <motion.div
          initial={{ opacity:0, y:40 }}
          whileInView={{ opacity:1, y:0 }}
          transition={{ duration:.7 }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl font-bold">
            Connect With <span className="text-yellow-400">Shygon</span>
          </h2>

          <p className="text-gray-400 mt-5">
            Scan the QR code or contact us directly.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* QR Card */}

          <motion.div
            whileHover={{ scale:1.03 }}
            className="bg-[#111111] border border-yellow-500/30 rounded-3xl p-10 text-center shadow-2xl"
          >

            <img
              src="/qr.png"
              alt="QR Code"
              className="mx-auto rounded-xl w-72"
            />

            <h3 className="text-2xl font-bold mt-8 text-yellow-400">
              Scan To Visit
            </h3>

            <p className="text-gray-400 mt-3">
              {SITE_URL}
            </p>

          </motion.div>

          {/* Contact Info */}

          <div>

            <div className="space-y-8">

              <div className="flex items-center gap-5">

                <Globe className="text-yellow-400"/>

                <div>

                  <p className="text-gray-400">

                    Website

                  </p>

                  <h4>

                    {SITE_URL}

                  </h4>

                </div>

              </div>

              <div className="flex items-center gap-5">

                <Instagram className="text-yellow-400"/>

                <div>

                  <p className="text-gray-400">

                    Instagram

                  </p>

                  <h4>

                    @shygon_technologies

                  </h4>

                </div>

              </div>

              <div className="flex items-center gap-5">

                <Phone className="text-yellow-400"/>

                <div>

                  <p className="text-gray-400">

                    Contact

                  </p>

                  <h4>

                    +91 9740806633

                  </h4>

                </div>

              </div>

            </div>

            <button
              className="mt-12 px-8 py-4 rounded-xl bg-yellow-500 text-black font-bold hover:scale-105 transition"
            >
              Contact Us
            </button>

          </div>

        </div>

      </div>
    </section>
  );
}