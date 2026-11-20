import { useEffect, useRef } from 'react';

interface AudioMeterCanvasProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

export function AudioMeterCanvas({ analyser, isActive }: AudioMeterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const barCount = 44;
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);

      if (isActive && analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const step = Math.max(1, Math.floor(dataArray.length / barCount));

        for (let i = 0; i < barCount; i++) {
          const val = dataArray[i * step] || 0;
          const normalized = val / 255;
          const barHeight = Math.max(4, normalized * (height - 8));
          const x = i * (barWidth + gap);
          const y = (height - barHeight) / 2;

          ctx.fillStyle = normalized > 0.35 ? '#2563EB' : '#64748B';
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 2);
          ctx.fill();
        }
        rafId = requestAnimationFrame(draw);
      } else {
        // Resting baseline
        for (let i = 0; i < barCount; i++) {
          const x = i * (barWidth + gap);
          const barHeight = 4;
          const y = (height - barHeight) / 2;
          ctx.fillStyle = '#CBD5E1';
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    draw();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [analyser, isActive]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={isActive ? 'Live microphone audio waveform' : 'Audio meter idle'}
      className="w-full h-16 block"
    />
  );
}
