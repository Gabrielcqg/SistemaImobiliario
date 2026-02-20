"use client";

import LedButton from "@/components/ui/LedButton";
import Button from "@/components/ui/Button";

export default function LedDemoPage() {
    return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-10 p-10">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--led-orange)] to-[var(--led-cyan)] bg-clip-text text-transparent">
                LED Button Demo
            </h1>

            <div className="flex flex-col gap-8 items-center bg-zinc-900/50 p-12 rounded-3xl border border-zinc-800">
                <div className="flex flex-col items-center gap-2 mb-8">
                    <p className="text-zinc-400 text-sm">✨ Hover over buttons to see the LED effect ✨</p>
                </div>

                <div className="flex items-end gap-6">
                    <Button size="sm">Small</Button>
                    <Button size="md">Medium</Button>
                    <Button size="lg">Large</Button>
                </div>

                <div className="grid grid-cols-4 gap-6 w-full place-items-center mt-8">
                    <span className="text-zinc-500 text-sm">Solid (Default)</span>
                    <span className="text-zinc-500 text-sm">Ghost</span>
                    <span className="text-zinc-500 text-sm">CTA (High Emphasis)</span>
                    <span className="text-zinc-500 text-sm">Subtle/Loading</span>

                    <LedButton variant="solid">Solid Button</LedButton>
                    <LedButton variant="ghost">Ghost Button</LedButton>
                    <LedButton variant="cta">CTA Button</LedButton>
                    <LedButton variant="subtle" isLoading>Loading</LedButton>
                </div>

                <div className="mt-8 flex gap-4">
                    <div className="bg-black p-8 rounded-xl border border-zinc-800 flex flex-col items-center gap-4">
                        <span className="text-zinc-400 text-sm mb-2">Dark Context (Black)</span>
                        <LedButton variant="cta">Call to Action</LedButton>
                    </div>
                    <div className="bg-zinc-900 p-8 rounded-xl border border-zinc-700 flex flex-col items-center gap-4">
                        <span className="text-zinc-400 text-sm mb-2">Lighter Context (Zinc 900)</span>
                        <LedButton variant="solid">Secondary Action</LedButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
