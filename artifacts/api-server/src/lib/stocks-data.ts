export interface StockInfo {
  ticker: string;
  company: string;
  focus: string;
  risk: string;
}

export interface StockCategory {
  name: string;
  color: string;
  description: string;
  stocks: StockInfo[];
}

export const CATEGORIES: StockCategory[] = [
  {
    name: "⚛️ Quantum Computing",
    color: "7030A0",
    description: "High-risk quantum plays — potential 10× returns within 2 years",
    stocks: [
      { ticker: "IONQ",  company: "IonQ Inc",         focus: "Quantum computing hardware & software", risk: "Very High" },
      { ticker: "RGTI",  company: "Rigetti Computing", focus: "Quantum computing chips & systems",     risk: "Very High" },
      { ticker: "QBTS",  company: "D-Wave Quantum",    focus: "Quantum annealing systems",             risk: "Very High" },
    ],
  },
  {
    name: "🖥️ Semiconductors & Compute",
    color: "0070C0",
    description: "Core semiconductor & compute names — stability + steady compounders",
    stocks: [
      { ticker: "NVDA", company: "NVIDIA Corp",              focus: "GPUs, AI compute",             risk: "Medium"    },
      { ticker: "AVGO", company: "Broadcom Inc",             focus: "Semiconductors, networking",   risk: "Medium"    },
      { ticker: "LRCX", company: "Lam Research",             focus: "Semiconductor equipment, DRAM",risk: "Medium"    },
      { ticker: "AMD",  company: "Advanced Micro Devices",   focus: "CPUs, GPUs, AI chips",         risk: "Medium"    },
      { ticker: "INTC", company: "Intel Corp",               focus: "CPUs, AI accelerators",        risk: "Med-High"  },
      { ticker: "ARM",  company: "Arm Holdings",             focus: "Chip architecture licensing",  risk: "Medium"    },
    ],
  },
  {
    name: "⚙️ AI Picks & Shovels",
    color: "C55A11",
    description: "Smaller-cap NVDA-adjacent setups — high risk, asymmetric upside",
    stocks: [
      { ticker: "NVTS", company: "Navitas Semiconductor",  focus: "GaN power chips for AI data centers",          risk: "High"      },
      { ticker: "AEHR", company: "AEHR Test Systems",      focus: "Semiconductor burn-in & test equipment",       risk: "High"      },
      { ticker: "CRDO", company: "Credo Technology",       focus: "High-speed connectivity / SerDes for AI DCs",  risk: "High"      },
      { ticker: "ALGM", company: "Allegro MicroSystems",   focus: "Power & sensing semiconductors",               risk: "Med-High"  },
      { ticker: "HIMX", company: "Himax Technologies",     focus: "Display drivers + AR/AI vision chips",         risk: "High"      },
      { ticker: "MTSI", company: "MACOM Technology",       focus: "RF, microwave, high-speed analog chips",       risk: "Med-High"  },
      { ticker: "AEVA", company: "Aeva Technologies",      focus: "Lidar + sensing for autonomous systems",       risk: "Very High" },
    ],
  },
  {
    name: "💡 Photonics & Optics",
    color: "00B0F0",
    description: "Optical networking — key bottleneck in AI data center interconnect",
    stocks: [
      { ticker: "LITE", company: "Lumentum Holdings", focus: "Photonics, optical components for AI DCs", risk: "High" },
    ],
  },
  {
    name: "🏗️ DC Builders & Cooling",
    color: "375623",
    description: "Builders, materials, and cooling companies powering AI data center construction",
    stocks: [
      { ticker: "CAT",  company: "Caterpillar Inc",     focus: "Heavy equipment, construction",         risk: "Low-Med" },
      { ticker: "FIX",  company: "Comfort Systems USA", focus: "HVAC, mechanical, electrical for DCs",  risk: "Medium"  },
      { ticker: "POWL", company: "Powell Industries",   focus: "Electrical infrastructure for DCs",     risk: "Medium"  },
      { ticker: "VRT",  company: "Vertiv Holdings",     focus: "Cooling systems for AI data centers",   risk: "Medium"  },
    ],
  },
  {
    name: "⚡ Power & Energy",
    color: "ED7D31",
    description: "Power generation, grid maintenance & nuclear energy for the AI buildout",
    stocks: [
      { ticker: "GEV",  company: "GE Vernova",      focus: "Power generation & grid equipment",       risk: "Medium"    },
      { ticker: "PWR",  company: "Quanta Services",  focus: "Power grid infrastructure & maintenance", risk: "Medium"    },
      { ticker: "BE",   company: "Bloom Energy",     focus: "Fuel cell power generation",              risk: "High"      },
      { ticker: "OKLO", company: "Oklo Inc",         focus: "Nuclear SMRs + nuclear fuel waste",       risk: "Very High" },
    ],
  },
  {
    name: "☁️ Neoclouds & AI Software",
    color: "5A2E8C",
    description: "Next-gen cloud infrastructure and AI software platforms",
    stocks: [
      { ticker: "NBIS", company: "Nebius Group",          focus: "Neocloud + Clickhouse + AV Ride",  risk: "High"     },
      { ticker: "PLTR", company: "Palantir Technologies", focus: "AI software, government AI stack",  risk: "Med-High" },
      { ticker: "RBRK", company: "Rubrik Inc",            focus: "Cybersecurity, data management",   risk: "Med-High" },
    ],
  },
  {
    name: "🛡️ Defense & Drones",
    color: "595959",
    description: "Defense technology and drone companies — $1.5T defense budget tailwind",
    stocks: [
      { ticker: "ONDS", company: "Ondas Holdings", focus: "Drones and defense tech", risk: "Very High" },
    ],
  },
  {
    name: "🚀 Space Economy",
    color: "002060",
    description: "Space infrastructure — long-duration compounder with SpaceX IPO catalyst",
    stocks: [
      { ticker: "RKLB", company: "Rocket Lab USA", focus: "Space economy & launch infrastructure", risk: "High" },
    ],
  },
];

export const ALL_TICKERS: string[] = CATEGORIES.flatMap(c => c.stocks.map(s => s.ticker));

export const TICKER_TO_COMPANY: Record<string, string> = Object.fromEntries(
  CATEGORIES.flatMap(c => c.stocks.map(s => [s.ticker, s.company]))
);
