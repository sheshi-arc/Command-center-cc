import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  Users,
  MessageSquare,
  Calendar,
  Clock,
  BarChart2,
  Award,
  Zap,
  LogOut,
  ChevronRight,
  Sun,
  Moon,
  User,
} from 'lucide-react';
import { USER_ROLES, type UserRole } from '@command-center/shared';
import { useTheme } from '../../contexts/ThemeContext.js';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  internType?: 'paid' | 'unpaid' | null;
  currentLevel?: number;
  avatarUrl?: string | null;
  emailVerified?: boolean;
}

interface SidebarProps {
  currentUser: CurrentUser;
  onLogout: () => void;
  onSwitchUser?: (role: UserRole) => void;
  className?: string;
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  onLogout,
  onSwitchUser,
  className = '',
  onNavigate,
}) => {
  const { theme, toggleTheme } = useTheme();
  const isAdmin = currentUser.role === USER_ROLES.ADMIN;
  const isLead = currentUser.role === USER_ROLES.LEAD;
  const isPaid = currentUser.role === USER_ROLES.PAID_INTERN;
  const isUnpaid = currentUser.role === USER_ROLES.UNPAID_INTERN;

  const internsLabel = isPaid ? 'My interns' : 'Interns';
  const certsLabel = isPaid || isUnpaid ? 'My certificate' : 'Certificates';

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/todo', label: 'To-Do', icon: CheckSquare },
    ...(!isUnpaid ? [{ to: '/interns', label: internsLabel, icon: Users }] : []),
    { to: '/chat', label: 'Chat', icon: MessageSquare },
    { to: '/calendar', label: 'Calendar', icon: Calendar },
    { to: '/attendance', label: 'Attendance', icon: Clock },
    { to: '/tracker', label: 'Tracker', icon: BarChart2 },
    { to: '/certificates', label: certsLabel, icon: Award },
    ...(isAdmin || isLead ? [{ to: '/automations', label: 'Automations', icon: Zap }] : []),
    { to: '/profile', label: 'Profile & Settings', icon: User },
  ];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case USER_ROLES.ADMIN:
        return 'Admin';
      case USER_ROLES.LEAD:
        return 'Co-admin / Leader';
      case USER_ROLES.PAID_INTERN:
        return 'Core intern';
      case USER_ROLES.UNPAID_INTERN:
        return 'Unpaid intern';
    }
  };

  return (
    <aside
      className={`w-64 bg-[#0e1629] text-slate-300 flex flex-col justify-between shrink-0 select-none ${className}`}
    >
      {/* Top Header & Navigation */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div className="flex items-center gap-3.5 px-6 py-6 border-b border-slate-800/80">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white text-base tracking-wider shadow-sm">
            CC
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight leading-none">
              Command Center
            </h1>
            <p className="text-[11px] font-medium text-slate-400 mt-1">Software Hub 2.0</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3.5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-slate-800/90 text-white shadow-xs font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* User Profile Footer */}
      <div className="p-3.5 border-t border-slate-800/80 bg-[#0b1222]">

        {/* Current User Pill */}
        <div className="flex items-center justify-between p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800/80 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-white text-slate-900 font-bold flex items-center justify-center text-xs shrink-0 shadow-xs">
              {getInitials(currentUser.name)}
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-white truncate">{currentUser.name}</h4>
              <p className="text-[11px] text-slate-400 truncate">{getRoleBadge(currentUser.role)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
