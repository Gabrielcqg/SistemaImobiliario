import { render, screen } from '@testing-library/react';
import { Navbar } from './Navbar';
import { describe, it, expect, vi } from 'vitest';

// Mock useAuth hook
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: null,
        logout: vi.fn(),
    }),
}));

describe('Navbar', () => {
    it('renders the brand name', () => {
        render(<Navbar />);
        expect(screen.getByText('ImoFinder')).toBeInTheDocument();
    });

    it('renders navigation links', () => {
        render(<Navbar />);
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('How it works')).toBeInTheDocument();
    });

    it('shows Sign In button when user is not logged in', () => {
        render(<Navbar />);
        expect(screen.getByText('Sign In')).toBeInTheDocument();
    });
});
