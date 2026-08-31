import type { DimensionMember, Model, Variable, VariableGroup } from "@/lib/model/types";

/**
 * Flattening the model into the list of rows the grid actually paints.
 *
 * Kept out of the component and free of React on purpose: "which rows are
 * visible right now" is the thing keyboard navigation, search and the
 * disclosure state all have to agree on, and three components each deriving it
 * their own way is how a grid ends up selecting a row that is not on screen.
 */

export type GridRow =
  | {
      kind: "group";
      key: string;
      group: VariableGroup;
      collapsed: boolean;
      /** Variables inside, after the search filter. */
      count: number;
    }
  | {
      kind: "variable";
      key: string;
      variable: Variable;
      expandable: boolean;
      expanded: boolean;
    }
  | {
      kind: "member";
      key: string;
      variable: Variable;
      member: DimensionMember;
    }
  | { kind: "add"; key: string; groupId: string };

export type FlattenOptions = {
  collapsedGroups: ReadonlySet<string>;
  expandedVariables: ReadonlySet<string>;
  query: string;
};

export function flattenRows(model: Model, options: FlattenOptions): GridRow[] {
  const { collapsedGroups, expandedVariables, query } = options;
  const needle = query.trim().toLowerCase();
  const dimensions = new Map(model.dimensions.map((d) => [d.id, d]));
  const rows: GridRow[] = [];

  for (const group of model.groups) {
    const groupMatches = needle !== "" && group.name.toLowerCase().includes(needle);

    const variables = model.variables.filter((v) => {
      if (v.groupId !== group.id) return false;
      if (!needle || groupMatches) return true;
      return v.name.toLowerCase().includes(needle);
    });

    // A group with nothing left in it disappears entirely rather than sitting
    // there as an empty heading — a filtered grid should read as a shorter
    // model, not as the same model full of holes.
    if (needle && variables.length === 0) continue;

    const collapsed = collapsedGroups.has(group.id);
    rows.push({
      kind: "group",
      key: `group:${group.id}`,
      group,
      collapsed,
      count: variables.length,
    });
    if (collapsed) continue;

    for (const variable of variables) {
      const dimension = variable.dimensionId ? dimensions.get(variable.dimensionId) : undefined;
      const expanded = expandedVariables.has(variable.id);

      rows.push({
        kind: "variable",
        key: `var:${variable.id}`,
        variable,
        expandable: Boolean(dimension),
        expanded: Boolean(dimension) && expanded,
      });

      if (dimension && expanded) {
        for (const member of dimension.members) {
          rows.push({
            kind: "member",
            key: `member:${variable.id}:${member.key}`,
            variable,
            member,
          });
        }
      }
    }

    // The add affordance is meaningless while a filter is on: the row would
    // land somewhere the user cannot see.
    if (!needle) rows.push({ kind: "add", key: `add:${group.id}`, groupId: group.id });
  }

  return rows;
}

/** Rows a cell selection can land on. Group and add rows are skipped. */
export function isSelectable(row: GridRow) {
  return row.kind === "variable" || row.kind === "member";
}
