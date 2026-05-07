import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PriceCellProps {
  price: number;
  lastUpdated: number;
  className?: string;
  testId?: string;
  prefix?: string;
  suffix?: string;
}

export function PriceCell({ price, lastUpdated, className, testId, prefix = "", suffix = "" }: PriceCellProps) {
  const prevPriceRef = useRef<number>(price);
  const prevLastUpdatedRef = useRef<number>(lastUpdated);
  const [flashClass, setFlashClass] = useState<string>("");

  useEffect(() => {
    if (lastUpdated !== prevLastUpdatedRef.current) {
      if (price > prevPriceRef.current) {
        setFlashClass("animate-flash-green text-green-500");
      } else if (price < prevPriceRef.current) {
        setFlashClass("animate-flash-red text-red-500");
      }

      prevPriceRef.current = price;
      prevLastUpdatedRef.current = lastUpdated;

      const timer = setTimeout(() => {
        setFlashClass("");
      }, 1000);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [price, lastUpdated]);

  return (
    <span
      data-testid={testId}
      className={cn("transition-colors duration-300 px-1 -mx-1 rounded font-mono tabular-nums", flashClass, className)}
    >
      {prefix}{price.toFixed(2)}{suffix}
    </span>
  );
}
