import { useEffect, useRef, useState } from 'react';
import { LOOP_PETS, LOOP_PET_TIMING, sampleLoopPetPlan } from '../../ui';

let cooldownUntil = 0;

interface VisibleLoopPet {
  frames: readonly string[];
  frame: number;
}

export function useLoopPet(running: boolean, turnKey: string): string | null {
  const [visible, setVisible] = useState<VisibleLoopPet | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const timers: number[] = [];
    let frameTimer: number | null = null;
    let cancelled = false;

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
      if (frameTimer != null) window.clearInterval(frameTimer);
      setVisible(null);
    };

    if (!running || !turnKey) {
      setVisible(null);
      return cancel;
    }

    const onUserInput = () => cancel();
    const onPageHidden = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    const onWindowBlur = () => cancel();
    document.addEventListener('input', onUserInput, true);
    document.addEventListener('visibilitychange', onPageHidden);
    window.addEventListener('blur', onWindowBlur);

    const thresholdTimer = window.setTimeout(() => {
      if (cancelled || Date.now() < cooldownUntil || document.visibilityState !== 'visible') {
        cancel();
        return;
      }
      const plan = sampleLoopPetPlan();
      const revealTimer = window.setTimeout(() => {
        if (cancelled || generation !== generationRef.current || document.visibilityState !== 'visible') {
          cancel();
          return;
        }
        cooldownUntil = Date.now() + LOOP_PET_TIMING.cooldownMs;
        const frames = LOOP_PETS[plan.petIndex];
        setVisible({ frames, frame: 0 });

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reducedMotion && frames.length > 1) {
          frameTimer = window.setInterval(() => {
            setVisible(current => current
              ? { ...current, frame: (current.frame + 1) % current.frames.length }
              : null);
          }, LOOP_PET_TIMING.frameMs);
        }

        const hideTimer = window.setTimeout(cancel, plan.visibleMs);
        timers.push(hideTimer);
      }, plan.delayMs);
      timers.push(revealTimer);
    }, LOOP_PET_TIMING.thresholdMs);
    timers.push(thresholdTimer);

    return () => {
      document.removeEventListener('input', onUserInput, true);
      document.removeEventListener('visibilitychange', onPageHidden);
      window.removeEventListener('blur', onWindowBlur);
      cancel();
    };
  }, [running, turnKey]);

  return visible ? visible.frames[visible.frame] : null;
}
