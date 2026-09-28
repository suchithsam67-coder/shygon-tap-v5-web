import { Phone, MessageCircle, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

export default function FloatingButtons() {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowTop(window.scrollY > 300);
    };

    window.addEventListener("scroll", handleScroll);

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-4">

      {showTop && (
        <button
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            })
          }
          className="w-14 h-14 rounded-full bg-yellow-500 text-black shadow-xl hover:scale-110 transition-all duration-300 flex items-center justify-center"
        >
          <ChevronUp size={24} />
        </button>
      )}

      <a
        href="https://wa.me/919740806633"
        target="_blank"
        rel="noopener noreferrer"
        className="w-14 h-14 rounded-full bg-green-500 text-white shadow-xl hover:scale-110 transition-all duration-300 flex items-center justify-center"
      >
        <MessageCircle size={24} />
      </a>

      <a
        href="tel:+919740806633"
        className="w-14 h-14 rounded-full bg-yellow-500 text-black shadow-xl hover:scale-110 transition-all duration-300 flex items-center justify-center"
      >
        <Phone size={22} />
      </a>

    </div>
  );
}