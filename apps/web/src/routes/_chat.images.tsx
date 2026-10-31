import { createFileRoute } from "@tanstack/react-router";
import { ImagesPage } from "~/components/images/ImagesPage";

export const Route = createFileRoute("/_chat/images")({ component: ImagesPage });
