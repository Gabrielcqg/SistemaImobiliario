"use client";

import { memo } from "react";
import ListingCard from "@/components/radar/ListingCard";
import type { Listing } from "@/hooks/useListings";

function RadarListingsGrid({ listings }: { listings: Listing[] }) {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

export default memo(RadarListingsGrid);
