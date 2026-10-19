import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LoginScreen } from '../screens/Login/LoginScreen.js';
import { SignUpScreen } from '../screens/SignUp/SignUpScreen.js';
import { AuthContext } from '../contexts/AuthContext.js';
import { ThemeProvider } from '../contexts/ThemeContext.js';
import * as apiModule from '../lib/api.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock window.matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock apiRequest
vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<any>('../lib/api.js');
  return {
    ...actual,
    apiRequest: vi.fn().mockResolvedValue({}),
  };
});

const mockAuthContextValue = {
  currentUser: null,
  isLoading: false,
  login: vi.fn(),
  register: vi.fn(),
  resendVerification: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
};

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <ThemeProvider>
      <AuthContext.Provider value={mockAuthContextValue as any}>
        <BrowserRouter>{ui}</BrowserRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
};

describe('Authentication Screens - Vitest + Testing Library', () => {
  describe('1. Login Form', () => {
    it('renders clean labels: Email, Password, Sign in button, Forgot password, and Create account link', () => {
      renderWithProviders(<LoginScreen />);

      // Plain labels
      expect(screen.getByLabelText(/^Email$/i)).toBeDefined();
      expect(screen.getByLabelText(/^Password$/i)).toBeDefined();

      // Buttons and Links
      expect(screen.getByRole('button', { name: /Sign in/i })).toBeDefined();
      expect(screen.getByText(/Forgot password\?/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /Create account/i })).toBeDefined();

      // "Keep me signed in" checkbox
      expect(screen.getByLabelText(/Keep me signed in/i)).toBeDefined();
    });

    it('toggles password visibility when show/hide button is clicked', () => {
      renderWithProviders(<LoginScreen />);

      const passwordInput = screen.getByLabelText(/^Password$/i) as HTMLInputElement;
      expect(passwordInput.type).toBe('password');

      const toggleButton = screen.getByRole('button', { name: /show password/i });
      fireEvent.click(toggleButton);

      expect(passwordInput.type).toBe('text');

      const hideButton = screen.getByRole('button', { name: /hide password/i });
      fireEvent.click(hideButton);

      expect(passwordInput.type).toBe('password');
    });

    it('submits credentials when form is filled and submitted', async () => {
      mockAuthContextValue.login.mockResolvedValueOnce(undefined as any);
      renderWithProviders(<LoginScreen />);

      const emailInput = screen.getByLabelText(/^Email$/i);
      const passwordInput = screen.getByLabelText(/^Password$/i);
      const submitButton = screen.getByRole('button', { name: /Sign in/i });

      fireEvent.change(emailInput, { target: { value: 'sriram@smru.edu.in' } });
      fireEvent.change(passwordInput, { target: { value: 'AdminPass123!@#' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockAuthContextValue.login).toHaveBeenCalledWith(
          'sriram@smru.edu.in',
          'AdminPass123!@#',
          true
        );
      });
    });
  });

  describe('2. Sign Up Form Validation', () => {
    it('renders all required fields: Full name, Email, Password, Confirm password', () => {
      renderWithProviders(<SignUpScreen />);

      expect(screen.getByLabelText(/Full name/i)).toBeDefined();
      expect(screen.getByLabelText(/^Email$/i)).toBeDefined();
      expect(screen.getByLabelText(/^Password$/i)).toBeDefined();
      expect(screen.getByLabelText(/^Confirm password$/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Create account/i })).toBeDefined();
    });

    it('displays live password rules and updates validation state dynamically', () => {
      renderWithProviders(<SignUpScreen />);

      // Password rule hints
      expect(screen.getByText(/At least 8 characters/i)).toBeDefined();
      expect(screen.getByText(/At least one letter/i)).toBeDefined();
      expect(screen.getByText(/At least one number/i)).toBeDefined();

      const passwordInput = screen.getByLabelText(/^Password$/i);

      // Type weak password
      fireEvent.change(passwordInput, { target: { value: 'abc' } });

      const submitButton = screen.getByRole('button', { name: /Create account/i });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // Type valid password
      fireEvent.change(passwordInput, { target: { value: 'StrongPass123' } });
      const confirmInput = screen.getByLabelText(/^Confirm password$/i);
      fireEvent.change(confirmInput, { target: { value: 'StrongPass123' } });

      const nameInput = screen.getByLabelText(/Full name/i);
      fireEvent.change(nameInput, { target: { value: 'Jane Doe' } });
      const emailInput = screen.getByLabelText(/^Email$/i);
      fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });

      expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    });

    it('flags password mismatch between password and confirm password', () => {
      renderWithProviders(<SignUpScreen />);

      const passwordInput = screen.getByLabelText(/^Password$/i);
      const confirmInput = screen.getByLabelText(/^Confirm password$/i);

      fireEvent.change(passwordInput, { target: { value: 'StrongPass123' } });
      fireEvent.change(confirmInput, { target: { value: 'DifferentPass123' } });

      expect(screen.getByText(/Passwords do not match/i)).toBeDefined();

      const submitButton = screen.getByRole('button', { name: /Create account/i });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('3. Forgot Password Flow', () => {
    it('opens forgot password modal, validates email and submits successfully', async () => {
      const apiRequestMock = vi.mocked(apiModule.apiRequest);
      apiRequestMock.mockResolvedValueOnce({
        message: 'If an account exists with this email, a password reset link has been sent.',
      });

      renderWithProviders(<LoginScreen />);

      // Open Forgot Password modal
      const forgotLink = screen.getByText(/Forgot password\?/i);
      fireEvent.click(forgotLink);

      expect(screen.getByRole('heading', { name: /Forgot password\?/i })).toBeDefined();

      const resetEmailInput = document.getElementById('forgot-email') as HTMLInputElement;
      expect(resetEmailInput).toBeDefined();
      fireEvent.change(resetEmailInput, { target: { value: 'sriram@smru.edu.in' } });

      const sendButton = screen.getByRole('button', { name: /Send reset link/i });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(apiRequestMock).toHaveBeenCalledWith('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: 'sriram@smru.edu.in' }),
        });
      });

      // Shows confirmation state
      await waitFor(() => {
        expect(screen.getByText(/password reset link has been sent/i)).toBeDefined();
      });
    });
  });
});
