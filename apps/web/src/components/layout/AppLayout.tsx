import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Menu,
  Sun,
  Moon,
  Bell,
  CheckCheck,
  CheckSquare,
  Home,
  MessageSquare,
  Clock,
  MoreHorizontal,
  BarChart2,
  Award,
  Calendar,
  Users,
  Zap,
  LogOut,
  ShieldCheck,
  VolumeX,
  Volume2,
} from 'lucide-react';
import { Sidebar, type CurrentUser } from './Sidebar.js';
import { USER_ROLES } from '@command-center/shared';
import { useTheme } from '../../contexts/ThemeContext.js';
import { apiRequest } from '../../lib/api.js';
import { Sheet } from '../ui/Sheet.js';

interface AppLayoutProps {
  currentUser: CurrentUser;
  onLogout: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ currentUser, onLogout }) => {
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();

  const isManagement =
    currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.LEAD;

  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const handleResendVerification = async () => {
    setIsResending(true);
    try {
      await apiRequest('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: currentUser.email }),
      });
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 5000);
    } catch {
      // ignore
    } finally {
      setIsResending(false);
    }
  };

  // 1. Fetch live notifications
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiRequest<{ unreadCount: number; notifications: any[] }>('/notifications').catch(() => ({
        unreadCount: 0,
        notifications: [],
      })),
    refetchInterval: 10000,
  });

  // Mark all notifications read
  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close notifications on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifData?.unreadCount ?? 0;
  const notifications = notifData?.notifications ?? [];

  // Bottom Navigation main 5 items
  const mainMobileTabs = [
    { label: 'Home', path: '/', icon: Home },
    { label: 'To-Do', path: '/todo', icon: CheckSquare },
    { label: 'Chat', path: '/chat', icon: MessageSquare },
    { label: 'Attendance', path: '/attendance', icon: Clock },
  ];

  return (
    <div className="flex h-screen w-screen overflow-x-hidden overflow-y-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Desktop Persistent Sidebar (>= 1024px) */}
      <div className="hidden lg:flex h-full shrink-0">
        <Sidebar currentUser={currentUser} onLogout={onLogout} />
      </div>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header (All viewports) */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-xs text-white shadow-xs">
              CC
            </div>
            <div>
              <h1 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                Software Hub 2.0
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Central Office Command Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setIsNotifOpen(!isNotifOpen)}
                className="relative p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Notifications"
                aria-label="View notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
                )}
              </button>

              {/* Notification Popover Dropdown */}
              {isNotifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Notifications
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => markReadMutation.mutate('all')}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                      >
                        <CheckCheck className="w-3.5 h-3.5" /> Mark read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 italic">
                        No new notifications
                      </div>
                    ) : (
                      notifications.map((n: any) => (
                        <div
                          key={n.id}
                          className={`p-3 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                            !n.is_read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                          }`}
                        >
                          <h4 className="font-bold text-slate-900 dark:text-white">{n.title}</h4>
                          <p className="text-slate-600 dark:text-slate-300 mt-0.5">{n.message}</p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {new Date(n.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            {/* User Pill */}
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {currentUser.name}
              </span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                {currentUser.role}
              </span>
            </div>
          </div>
        </header>

        {/* Email verification reminder banner */}
        {currentUser && currentUser.emailVerified === false && (
          <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900/60 px-4 py-2 flex items-center justify-between text-xs text-amber-800 dark:text-amber-200 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Verify your email to secure your account.</span>
              {resendSuccess && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  (Verification email sent!)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isResending}
              className="font-bold underline hover:no-underline text-amber-900 dark:text-amber-100 min-h-[32px] px-2 flex items-center disabled:opacity-50"
            >
              {isResending ? 'Sending...' : 'Resend link'}
            </button>
          </div>
        )}

        {/* Scrollable Viewport for Screen Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-6 lg:p-8 pb-20 lg:pb-8">
          <Outlet />
        </main>

        {/* Mobile Bottom Navigation Bar (< 1024px) */}
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex items-center justify-around px-2 py-1 shadow-lg pb-safe"
          aria-label="Mobile Navigation"
        >
          {mainMobileTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = location.pathname === tab.path;
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[44px] min-w-[44px] transition-colors ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-bold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
                <span className="text-[10px] mt-0.5">{tab.label}</span>
              </NavLink>
            );
          })}

          {/* 5th Button: More Sheet Trigger */}
          <button
            type="button"
            onClick={() => setIsMoreSheetOpen(true)}
            className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[44px] min-w-[44px] transition-colors ${
              isMoreSheetOpen
                ? 'text-blue-600 dark:text-blue-400 font-bold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-label="Open secondary navigation menu"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] mt-0.5">More</span>
          </button>
        </nav>
      </div>

      {/* "More" Bottom Sheet for secondary mobile navigation */}
      <Sheet
        isOpen={isMoreSheetOpen}
        onClose={() => setIsMoreSheetOpen(false)}
        title="Central Office Menu"
        description={`Signed in as ${currentUser.name} (${currentUser.role})`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                navigate('/tracker');
                setIsMoreSheetOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
            >
              <BarChart2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Operations Tracker</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigate('/certificates');
                setIsMoreSheetOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
            >
              <Award className="w-4 h-4 text-amber-500" />
              <span>Certificates</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigate('/calendar');
                setIsMoreSheetOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
            >
              <Calendar className="w-4 h-4 text-emerald-500" />
              <span>Office Calendar</span>
            </button>

            {isManagement && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/interns');
                    setIsMoreSheetOpen(false);
                  }}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
                >
                  <Users className="w-4 h-4 text-purple-500" />
                  <span>Roster & Interns</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigate('/automations');
                    setIsMoreSheetOpen(false);
                  }}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
                >
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>Email Automations</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                navigate('/profile');
                setIsMoreSheetOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
            >
              <Users className="w-4 h-4 text-emerald-500" />
              <span>Profile & Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigate('/verify');
                setIsMoreSheetOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 text-left min-h-[44px] transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-500" />
              <span>Verify Credential</span>
            </button>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 min-h-[44px] p-2"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" /> Light Mode
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4" /> Dark Mode
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMoreSheetOpen(false);
                onLogout();
              }}
              className="flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 min-h-[44px] p-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
};
export default AppLayout;
