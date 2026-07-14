/**
 * Drives the "import folders as albums" dialog. Picking folders opens this with
 * the chosen paths instead of scanning directly, so the user decides — from one
 * place — whether to mirror the folder tree as albums or just import the media.
 *
 * `payload` holds the picked folder paths awaiting the import decision (`null`
 * when closed).
 */
import { createDialogStore } from "@/stores/createDialogStore";

export const useImportAlbumsDialog = createDialogStore<string[]>((paths) => paths.length === 0);
