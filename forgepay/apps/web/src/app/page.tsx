import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import HowItWorks from '@/components/HowItWorks';
import Pricing from '@/components/Pricing';
import DeveloperPreview from '@/components/DeveloperPreview';
import Footer from '@/components/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-navy-800">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <DeveloperPreview />
      <Pricing />
      <Footer />
    </main>
  );
}
