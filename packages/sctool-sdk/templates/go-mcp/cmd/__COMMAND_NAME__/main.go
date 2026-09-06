package main

import (
	"fmt"
	"os"

	"__MODULE_PATH__/internal/server"
	"__MODULE_PATH__/internal/version"
)

func main() {
	for _, arg := range os.Args[1:] {
		if arg == "--version" || arg == "-version" {
			fmt.Printf("%s %s (%s, %s)\n", version.ServerName, version.Version, version.Commit, version.BuildDate)
			return
		}
	}

	if err := server.Run(
		os.Stdin,
		os.Stdout,
		version.ServerName,
		version.ServerTitle,
		version.Version,
	); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
