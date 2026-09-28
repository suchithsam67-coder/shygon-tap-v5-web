import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSection';
import AboutSection from '../components/AboutSection';
import TechnologyDivisions from '../components/TechnologyDivisions';
import FutureProjects from '../components/FutureProjects';
import WhyChooseUs from '../components/WhyChooseUs';
import Timeline from '../components/Timeline';
import ContactSection from '../components/ContactSection';
import Footer from '../components/Footer';
import ProjectConsultation from "../components/ProjectConsultation";
import DevelopmentProcess from "../components/DevelopmentProcess";
import FloatingButtons from "../components/FloatingButtons";
import WebServicesSection from "../components/WebServicesSection";

export default function Home() {
  return (
    <>
      <Navbar />
      <HeroSection />
      <WebServicesSection />
      <AboutSection />
      <TechnologyDivisions />
      <DevelopmentProcess />
      <FutureProjects />
      <WhyChooseUs />
      <Timeline />
      <ProjectConsultation />
      <ContactSection />
      <Footer />
      <FloatingButtons />
    </>
  );
}