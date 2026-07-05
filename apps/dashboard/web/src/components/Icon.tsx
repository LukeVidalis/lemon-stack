import {
  Activity,
  BarChart2,
  Box,
  Calendar,
  Code,
  Database,
  Home,
  Image,
  Lock,
  MapPin,
  Monitor,
  Server,
  Settings,
  Shield,
  Star,
  Users,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  utensils: Utensils,
  users: Users,
  calendar: Calendar,
  shield: Shield,
  zap: Zap,
  home: Home,
  image: Image,
  map: MapPin,
  box: Box,
  activity: Activity,
  'bar-chart': BarChart2,
  lock: Lock,
  settings: Settings,
  star: Star,
  server: Server,
  database: Database,
  code: Code,
  monitor: Monitor,
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  const Component = icons[name];
  if (!Component) return null;
  return <Component size={size} className={className} />;
}
