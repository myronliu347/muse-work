import React from "react";
import { Text } from "@radix-ui/themes";
import "../styles/Field.css";

export function Field(props: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="muse-field">
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.error ? (
        <Text size="1" color="red">
          {props.error}
        </Text>
      ) : null}
      {props.hint && !props.error ? (
        <Text size="1" color="gray">
          {props.hint}
        </Text>
      ) : null}
    </div>
  );
}
