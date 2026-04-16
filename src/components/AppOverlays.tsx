import { useState, useCallback, useEffect } from "react";
import TutorialOverlay from "./tutorial/TutorialOverlay";
import TutorialWelcomeModal from "./tutorial/TutorialWelcomeModal";
import GardenAssistant from "./assistant/GardenAssistant";
import LoginModal from "./LoginModal";
import {
  GARDEN_TOUR,
  getPageHelpSteps,
  type TourStep,
} from "./tutorial/tour-definitions";

const ONBOARDING_KEY = "garten-onboarding-done";
const TOUR_STATE_KEY = "garten-tour-state";

export default function AppOverlays({ pathname = "/" }: { pathname?: string }) {
  // ─── Tutorial State ─────────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourSteps, setTourSteps] = useState<TourStep[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Check if onboarding should be shown
  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) {
      const timer = setTimeout(() => setShowWelcome(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Resume tour from localStorage (for page navigation)
  useEffect(() => {
    const saved = localStorage.getItem(TOUR_STATE_KEY);
    if (!saved) return;

    try {
      JSON.parse(saved);
      localStorage.removeItem(TOUR_STATE_KEY);

      const currentPageSteps = GARDEN_TOUR.filter(
        (s) => s.page === pathname
      );
      if (currentPageSteps.length > 0) {
        setTourSteps(currentPageSteps);
        setTourStep(0);
        setTourActive(true);
      }
    } catch {
      localStorage.removeItem(TOUR_STATE_KEY);
    }
  }, [pathname]);

  // Listen for help requests from Sidebar/MobileHeader
  useEffect(() => {
    const handleStartHelp = () => {
      const steps = getPageHelpSteps(pathname);
      if (steps.length === 0) return;
      setTourSteps(steps);
      setTourStep(0);
      setTourActive(true);
    };

    window.addEventListener("start-page-help", handleStartHelp);
    return () => window.removeEventListener("start-page-help", handleStartHelp);
  }, [pathname]);

  // Listen for login modal requests from Sidebar/MobileHeader
  useEffect(() => {
    const handleOpenLogin = () => setShowLoginModal(true);
    window.addEventListener("open-login", handleOpenLogin);
    return () => window.removeEventListener("open-login", handleOpenLogin);
  }, []);

  const startTour = useCallback(() => {
    setShowWelcome(false);
    const steps = getPageHelpSteps(pathname);
    if (steps.length > 0) {
      setTourSteps(steps);
      setTourStep(0);
      setTourActive(true);
    } else {
      const firstStep = GARDEN_TOUR[0];
      if (firstStep && pathname !== firstStep.page) {
        localStorage.setItem(
          TOUR_STATE_KEY,
          JSON.stringify({ stepIndex: 0 })
        );
        window.location.href = firstStep.page;
      }
    }
    localStorage.setItem(ONBOARDING_KEY, "true");
  }, [pathname]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    localStorage.setItem(ONBOARDING_KEY, "true");
  }, []);

  const nextStep = useCallback(() => {
    if (tourStep >= tourSteps.length - 1) {
      setTourActive(false);
      setTourStep(0);
      setTourSteps([]);

      const currentPageIndex = GARDEN_TOUR.findIndex(
        (s) => s.page === pathname
      );
      const nextPageStep = GARDEN_TOUR.find(
        (s, i) => i > currentPageIndex && s.page !== pathname
      );
      if (nextPageStep) {
        localStorage.setItem(
          TOUR_STATE_KEY,
          JSON.stringify({ stepIndex: 0 })
        );
        window.location.href = nextPageStep.page;
      }
      return;
    }
    setTourStep((prev) => prev + 1);
  }, [tourStep, tourSteps.length, pathname]);

  const prevStep = useCallback(() => {
    setTourStep((prev) => Math.max(0, prev - 1));
  }, []);

  const skipTour = useCallback(() => {
    setTourActive(false);
    setTourStep(0);
    setTourSteps([]);
    localStorage.removeItem(TOUR_STATE_KEY);
    localStorage.setItem(ONBOARDING_KEY, "true");
  }, []);

  const handleLoginSuccess = useCallback(() => {
    const storedUser = localStorage.getItem("voigt-garten-user");
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        window.dispatchEvent(new CustomEvent("auth-change", { detail: { user: userData } }));
      } catch {}
    }
    setShowLoginModal(false);
  }, []);

  return (
    <>
      {/* Welcome Modal */}
      {showWelcome && (
        <TutorialWelcomeModal
          onStartTour={startTour}
          onDismiss={dismissWelcome}
        />
      )}

      {/* Tutorial Overlay */}
      <TutorialOverlay
        isActive={tourActive}
        currentStep={tourStep}
        steps={tourSteps}
        onNext={nextStep}
        onPrev={prevStep}
        onSkip={skipTour}
      />

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />

      {/* AI Assistant */}
      <GardenAssistant />
    </>
  );
}
